-- Dev passes (worker/pass.js): a coin's creator fees locked to its creator (pass NULL) or paid to whoever holds a
-- Metaplex Core NFT. And every creator-fee payout, by who it went to.
ALTER TABLE coins ADD COLUMN pass TEXT;

CREATE TABLE claims (
  sig TEXT NOT NULL,
  mint TEXT NOT NULL,
  wallet TEXT NOT NULL,      -- who was paid: the creator, or the pass's holder then
  sol REAL NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (sig, mint)
);
CREATE INDEX claims_mint ON claims (mint, ts);
