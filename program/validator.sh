#!/bin/bash
# A local validator for the program test: Raydium CPMM (program, the 0.25% config, the pool-fee account), Metaplex (and Core, for dev passes)
# cloned from mainnet through the Helius RPC in keys/RPC_URL.txt, and this program loaded fresh from target/deploy.
cd "$(dirname "$0")"
export COPYFILE_DISABLE=1 # macOS: no ._ files in the genesis archive
rm -rf test-ledger
exec solana-test-validator --reset --ledger test-ledger --quiet \
  --url "$(cat ../keys/RPC_URL.txt)" \
  --clone-upgradeable-program CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C \
  --clone-upgradeable-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s \
  --clone-upgradeable-program CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d \
  --clone D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2 \
  --clone DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8 \
  --upgradeable-program strqZGb3RoGux1Z8s5pu7dLEB9G2QqEix4hTRC9p5DU target/deploy/strict.so ../keys/deployer.json \
  --rpc-port 8899 --faucet-port 9911
