/**
 * Environment resolution.
 *
 * Every value is read through a function that fails with an actionable message
 * rather than defaulting to something plausible. A silent default here means
 * publishing to the wrong chain or approving on the wrong account.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  getAddress,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { monad, monadTestnet } from "viem/chains";

export interface Env {
  readonly rpcUrl: string;
  readonly chainId: 143 | 10143;
  readonly registry: Address;
  readonly account: Address;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function requiredAddress(name: string): Address {
  const value = required(name);
  if (!isAddress(value)) throw new Error(`${name} is not a valid address: ${value}`);
  return getAddress(value);
}

export function resolveEnv(): Env {
  const chainIdRaw = process.env.CHAIN_ID ?? "10143";
  if (chainIdRaw !== "143" && chainIdRaw !== "10143") {
    throw new Error(`CHAIN_ID must be 143 (Monad mainnet) or 10143 (testnet), got ${chainIdRaw}`);
  }
  const chainId = Number(chainIdRaw) as 143 | 10143;

  return {
    chainId,
    rpcUrl:
      process.env.RPC_URL ??
      (chainId === 143 ? "https://rpc.monad.xyz" : "https://testnet-rpc.monad.xyz"),
    registry: requiredAddress("PIN_REGISTRY"),
    account: requiredAddress("ACCOUNT_ADDRESS"),
  };
}

export function chainFor(chainId: 143 | 10143) {
  return chainId === 143 ? monad : monadTestnet;
}

export function publicClientFor(env: Env): PublicClient {
  return createPublicClient({
    chain: chainFor(env.chainId),
    transport: http(env.rpcUrl),
  }) as PublicClient;
}

/**
 * A signer from a private key in the environment.
 *
 * @param name env var holding the key. Kept out of logs; only the derived
 *             address is ever printed.
 *
 * The return type is annotated rather than inferred: viem's wallet client type is
 * large enough that TypeScript refuses to serialise the inferred form.
 */
export interface Signer {
  readonly account: PrivateKeyAccount;
  readonly wallet: WalletClient<Transport, Chain, PrivateKeyAccount>;
}

export function signerFor(env: Env, name: string): Signer {
  const key = required(name);
  const normalised = (key.startsWith("0x") ? key : `0x${key}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalised)) {
    throw new Error(`${name} must be a 32-byte hex private key`);
  }
  const account = privateKeyToAccount(normalised);
  return {
    account,
    wallet: createWalletClient({
      account,
      chain: chainFor(env.chainId),
      transport: http(env.rpcUrl),
    }),
  };
}
