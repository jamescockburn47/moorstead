"""Two distinct live accounts must consent within one 30-second window."""
import math
import time
from collections import deque

from freeplay_rules import Refused


class ResetVote:
    def __init__(self, hub, clock=time.monotonic):
        self.hub, self.clock = hub, clock
        self.votes, self.deadline = {}, 0
        self.kind = None
        self.used = deque(maxlen=4096)

    def clear(self):
        active = bool(self.votes)
        self.votes.clear()
        self.deadline = 0
        self.kind = None
        return active

    def state(self, request_id=None):
        return {"type": "reset-vote", "epoch": self.hub.epoch, "requestId": request_id,
                "voters": list(self.votes), "kind": self.kind, "remaining": max(0, math.ceil(self.deadline - self.clock()))}

    def approve(self, peer, request_id, kind="reset"):
        if self.votes and (self.clock() >= self.deadline or any(
                self.hub.peers.get(pid) is not voter for pid, voter in self.votes.items())):
            self.clear()
        if len(self.hub.peers) != 2:
            raise Refused("reset-pair", "Both players must be online together to reset the world.")
        # Revalidate both sessions at the destructive boundary, including revocation.
        for other in self.hub.peers.values():
            self.hub.session(other.pid, other.token)
        if self.votes and self.kind != kind:
            raise Refused("reset-kind", "Both players must approve the same action. Wait for the current vote to expire.")
        key = (peer.pid, request_id)
        if key in self.used:
            raise Refused("reset-replay", "That reset approval was already used. Press the button again.")
        self.used.append(key)
        if not self.votes:
            self.deadline = self.clock() + 30
            self.kind = kind
        self.votes[peer.pid] = peer  # Repeated clicks/devices never count as a second account.
        if len(self.votes) == 2:
            self.clear()  # A failed save requires fresh consent; never retry it automatically.
            return True
        return False

    async def expire(self):
        if self.votes and self.clock() >= self.deadline:
            async with self.hub.lock:
                if self.votes and self.clock() >= self.deadline:
                    self.clear()
                    await self.hub.notice(self.state())
