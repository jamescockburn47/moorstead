import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import test_service as service_tests
from test_battle import flat_arena
from freeplay_battle import Battle
from freeplay_reset_vote import ResetVote
from freeplay_rules import Refused


class VoteTests(unittest.TestCase):
    def setUp(self):
        self.now = 100
        self.a = SimpleNamespace(pid='ahenry', token='one')
        self.b = SimpleNamespace(pid='ajames', token='two')
        self.hub = SimpleNamespace(epoch=1, peers={self.a.pid:self.a,self.b.pid:self.b}, session=lambda *args: None)
        self.vote = ResetVote(self.hub, lambda:self.now)

    def test_distinct_accounts_duplicate_click_and_expiry(self):
        self.assertFalse(self.vote.approve(self.a, 'request-1'))
        self.now = 129
        self.assertFalse(self.vote.approve(self.a, 'request-2'))
        self.assertEqual(self.vote.deadline, 130, 'repeated presses cannot extend consent')
        self.now = 130
        self.assertFalse(self.vote.approve(self.b, 'request-3'), 'expired first vote cannot reset')
        with self.assertRaises(Refused):
            self.vote.approve(self.a, 'request-1')
        self.assertTrue(self.vote.approve(self.a, 'request-4'))
        self.assertEqual(self.vote.votes, {})

    def test_disconnect_replacement_revocation_and_third_player(self):
        self.vote.approve(self.a, 'request-1')
        self.hub.peers[self.a.pid] = SimpleNamespace(pid=self.a.pid, token='new-device')
        self.assertFalse(self.vote.approve(self.b, 'request-2'))
        with patch.object(self.hub, 'session', side_effect=Refused('access','Revoked')):
            with self.assertRaises(Refused):
                self.vote.approve(self.hub.peers[self.a.pid], 'request-3')
        self.hub.peers.pop(self.a.pid)
        with self.assertRaises(Refused):
            self.vote.approve(self.b, 'request-4')
        self.hub.peers.update({self.a.pid:self.a,'aguest':SimpleNamespace(pid='aguest',token='guest')})
        with self.assertRaises(Refused):
                self.vote.approve(self.a, 'request-5')

    def test_reset_and_restore_votes_cannot_mix(self):
        self.assertFalse(self.vote.approve(self.a, 'request-1', 'reset'))
        with self.assertRaises(Refused):
            self.vote.approve(self.b, 'request-2', 'restore')
        self.assertEqual(len(self.vote.votes), 1)


class ResetIntegrationTests(unittest.TestCase):
    setUp = service_tests.ServiceTests.setUp
    login = service_tests.ServiceTests.login
    socket = service_tests.ServiceTests.socket
    start = service_tests.ServiceTests.start
    collect = service_tests.ServiceTests.collect
    command = service_tests.ServiceTests.command

    def send(self, socket, login, value):
        self.app.state.freeplay_hub.peers['a'+login['acct']].last_command=0
        socket.send_json(value)

    def test_real_socket_two_approvals_once_restore_and_stale_replay(self):
        hub=self.app.state.freeplay_hub
        with self.socket(self.henry) as a, self.socket(self.james) as b:
            self.start(a);self.start(b)
            self.send(a,self.henry,self.command(edits=[[1,20,1,8]]))
            self.collect(a,'commit');self.collect(b,'commit')
            first=self.command('reset',confirm=True)
            self.send(a,self.henry,first)
            one=self.collect(a,'reset-vote')[-1];self.collect(b,'reset-vote')
            self.assertEqual(len(one['voters']),1)
            self.assertEqual(hub.store.state()['count'],1)
            self.send(a,self.henry,self.command('reset',confirm=True))
            self.collect(a,'reset-vote');self.collect(b,'reset-vote')
            self.assertEqual(hub.store.state()['epoch'],1,'same account twice is not consent')
            hub.battle.core=Battle(flat_arena())
            hub.battle.core.join('a'+self.james['acct'],'James','red')
            hub.battle.core.players['a'+self.james['acct']]['hp']=0
            hub.battle.core.flags.phase='active'
            self.send(b,self.james,self.command('reset',confirm=True))
            self.collect(a,'commit');self.collect(b,'commit')
            self.assertEqual((hub.store.state()['count'],hub.store.state()['epoch']),(0,2))
            self.assertTrue(hub.store.state()['checkpoint'])
            self.assertEqual(hub.battle.core.players['a'+self.james['acct']]['hp'],100,'knocked-out second voter can reset')
            self.send(a,self.henry,first)
            self.assertEqual(self.collect(a,'error')[-1]['code'],'stale')
            self.send(b,self.james,self.command('restore',confirm=True))
            self.collect(a,'reset-vote');self.collect(b,'reset-vote')
            self.assertEqual(hub.store.state()['epoch'],2)
            self.send(a,self.henry,self.command('restore',confirm=True))
            self.collect(a,'commit');self.collect(b,'commit')
            self.assertEqual(list(hub.store.snapshot())[0],[[1,20,1,8]])

    def test_alone_and_stale_command_cannot_vote(self):
        hub=self.app.state.freeplay_hub
        with self.socket(self.henry) as a:
            self.start(a)
            self.send(a,self.henry,self.command('reset',confirm=True))
            self.assertEqual(self.collect(a,'error')[-1]['code'],'reset-pair')
            self.assertFalse(hub.reset_vote.votes)
            with self.socket(self.james) as b:
                self.start(b)
                stale=self.command('reset',confirm=True);stale['epoch']=999
                self.send(a,self.henry,stale)
                self.assertEqual(self.collect(a,'error')[-1]['code'],'stale')
                self.assertEqual(hub.store.state()['epoch'],1)

    def test_save_failure_consumes_consent_but_preserves_world(self):
        hub=self.app.state.freeplay_hub
        # Exercise the real locked service boundary with existing authenticated sessions.
        async def scenario():
            peers=[]
            for login in (self.henry,self.james):
                async def send(_): pass
                peer=SimpleNamespace(pid='a'+login['acct'],token=login['token'],name=login['name'],send=send)
                peers.append(peer);hub.peers[peer.pid]=peer
            await hub.command(peers[0],self.command(edits=[[1,20,1,8]]))
            await hub.command(peers[0],self.command('reset',confirm=True))
            with patch.object(hub.store,'apply',side_effect=OSError('disk failure')):
                with self.assertRaises(OSError):
                    await hub.command(peers[1],self.command('reset',confirm=True))
            self.assertFalse(hub.reset_vote.votes)
            self.assertEqual(hub.store.state()['count'],1)
            hub.peers.clear()
        asyncio.run(scenario())
