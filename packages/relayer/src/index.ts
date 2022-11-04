import { FeeOptionsResponse } from '@biconomy-sdk/core-types'
import { RelayTransaction, RelayResponse } from '@biconomy-sdk/core-types'
import { EventEmitter } from 'isomorphic-ws'
export interface IRelayer {
  // relayer will submit the transaction(s) to the network and return the transaction response.

  getFeeOptions(chainId: number): Promise<FeeOptionsResponse>
  relay(relayTransaction: RelayTransaction, engine: EventEmitter): Promise<RelayResponse>

  // Tackled using messaging sdk
  // wait(metaTxnId: string | SignedTransactions, timeout: number): Promise<TransactionResponse>
}

export * from './local-relayer'
export * from './rest-relayer'
