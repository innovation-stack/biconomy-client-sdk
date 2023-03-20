import {
  SignTransactionDto,
  SendTransactionDto,
  SendSignedTransactionDto,
  PrepareRefundTransactionDto,
  PrepareRefundTransactionsDto,
  RefundTransactionDto,
  RefundTransactionBatchDto,
  TransactionDto,
  TransactionBatchDto,
  ExecTransaction,
  RelayTransaction,
  IFeeRefundV1_0_0,
  IFeeRefundV1_0_1,
  IWalletTransaction,
  SmartAccountVersion,
  SignedTransaction,
  ChainId,
  SignTypeMethod,
  SmartAccountContext,
  SmartWalletFactoryContract,
  MultiSendContract,
  SmartWalletContract,
  AddressForCounterFactualWalletDto,
  RawTransactionType,
  SmartAccountState,
  FeeQuote,
  RelayResponse,
  SmartAccountConfig,
  IMetaTransaction,
  NetworkConfig,
  ZERO_ADDRESS,
  IFallbackAPI
} from '@biconomy/core-types'
import { TypedDataSigner } from '@ethersproject/abstract-signer'
import NodeClient, {
  ISmartAccount,
  ChainConfig,
  SmartAccountsResponse,
  SmartAccountByOwnerDto,
  SCWTransactionResponse,
  BalancesResponse,
  BalancesDto,
  UsdBalanceResponse
} from '@biconomy/node-client'
import { Provider, Web3Provider } from '@ethersproject/providers'
import { IRelayer, RestRelayer, FallbackRelayer, IFallbackRelayer } from '@biconomy/relayer'
import * as _ from 'lodash'
import TransactionManager, {
  ContractUtils,
  encodeMultiSend,
  smartAccountSignMessage,
  smartAccountSignTypedData
} from '@biconomy/transactions'
import EventEmitter from 'events'
import { TransactionResponse } from '@ethersproject/providers'
import { SmartAccountSigner } from './signers/SmartAccountSigner'

// AA
import {
  newProvider,
  ERC4337EthersProvider,
  FallbackGasTankAPI,
  ERC4337EthersSigner,
  BaseAccountAPI
} from '@biconomy/account-abstraction'
import { deployCounterFactualEncodedData, getWalletInfo } from '@biconomy/common'
import { updateImplementationEncodedData, fallbackHandlerEncodedData } from '@biconomy/common'

import { BigNumber, ethers, Signer } from 'ethers'
import { Transaction } from '@biconomy/core-types'

let isLogsEnabled = false

// Create an instance of Smart Account with multi-chain support.
class SmartAccount extends EventEmitter {
  // By default latest version
  DEFAULT_VERSION: SmartAccountVersion = '1.0.0'

  // Smart Account Context provies relevant contract instances for chainId asked (default is current active chain)
  context!: { [chainId: number]: SmartAccountContext }

  // Optional config to initialise instance of Smart Account. One can provide main active chain and only limited chains they need to be on.
  #smartAccountConfig!: SmartAccountConfig

  // Array of chain ids that current multi-chain instance supports
  supportedNetworkIds!: ChainId[]

  // Chain configurations fetched from backend
  chainConfig!: ChainConfig[]

  provider!: Web3Provider

  // 4337Provider
  aaProvider!: { [chainId: number]: ERC4337EthersProvider }

  signer!: Signer

  nodeClient!: NodeClient

  contractUtils!: ContractUtils

  transactionManager!: TransactionManager

  // Instance of relayer (Relayer Service Client) connected with this Smart Account and always ready to dispatch transactions
  // relayer.relay => dispatch to blockchain
  // other methods are useful for the widget
  relayer!: IRelayer

  fallbackRelayer!: IFallbackRelayer

  private signingService!: IFallbackAPI

  // Owner of the Smart Account common between all chains
  owner!: string

  // Address of the smart contract wallet common between all chains
  // @review
  address!: string

  // TODO : review from contractUtils
  smartAccountState!: SmartAccountState

  // provider type could be WalletProviderLike / ExternalProvider
  // Can expose recommended provider classes through the SDK
  // Note: If required Dapp devs can just pass on the signer in future

  /**
   * Constructor for the Smart Account. If config is not provided it makes Smart Account available using default configuration
   * If you wish to use your own backend server and relayer service, pass the URLs here
   */
  // Note: Could remove WalletProvider later on
  constructor(signerOrProvider: Web3Provider | Signer, config?: Partial<SmartAccountConfig>) {
    super()
    if (config && config.debug === true) {
      isLogsEnabled = true
    }
    this.#smartAccountConfig = { ...DefaultSmartAccountConfig }
    this._logMessage('stage 1 : default config')
    this._logMessage(this.#smartAccountConfig)
    this._logMessage(this.#smartAccountConfig.networkConfig)

    if (!this.#smartAccountConfig.activeNetworkId) {
      throw Error('active chain needs to be specified')
    }

    if (this.#smartAccountConfig.supportedNetworksIds.length == 0)
      this.#smartAccountConfig.supportedNetworksIds = [this.#smartAccountConfig.activeNetworkId]

    let networkConfig: NetworkConfig[] = this.#smartAccountConfig.networkConfig

    if (config) {
      const customNetworkConfig: NetworkConfig[] = config.networkConfig || []
      this._logMessage('default network config')
      this._logMessage(networkConfig)
      this._logMessage('custom network config')
      this._logMessage(config.networkConfig)
      networkConfig = _.unionBy(customNetworkConfig, networkConfig, 'chainId')
      this._logMessage('merged network config values')
      this._logMessage(networkConfig)
      this._logMessage('smart account config before merge')
      this._logMessage(this.#smartAccountConfig)
      this.#smartAccountConfig = { ...this.#smartAccountConfig, ...config }
      this.#smartAccountConfig.networkConfig = networkConfig
      this._logMessage('final smart account config before after merge')
      this._logMessage(this.#smartAccountConfig)
    }
    this.supportedNetworkIds = this.#smartAccountConfig.supportedNetworksIds

    if (Signer.isSigner(signerOrProvider)) {
      this.signer = signerOrProvider
    } else if (Provider.isProvider(signerOrProvider)) {
      this.signer = new SmartAccountSigner(signerOrProvider)
    } else {
      this._logMessage('signer or provider is not valid')
    }
    this.nodeClient = new NodeClient({ txServiceUrl: this.#smartAccountConfig.backendUrl })
    this.relayer = new RestRelayer({
      url: this.#smartAccountConfig.relayerUrl,
      socketServerUrl: this.#smartAccountConfig.socketServerUrl
    })
    this.aaProvider = {}
    this.chainConfig = []
  }

  /**
   * Single method to be used for logging purpose.
   *
   * @param {any} message Message to be logged
   */
  _logMessage(message: any) {
    if (isLogsEnabled && console.log) {
      console.log(message)
    }
  }

  getConfig(): SmartAccountConfig {
    return this.#smartAccountConfig
  }

  // Changes if we make change in nature of smart account signer
  getsigner(): Signer {
    return this.signer
  }

  getSmartAccountAPI(chainId: ChainId): BaseAccountAPI {
    chainId = chainId ? chainId : this.#smartAccountConfig.activeNetworkId
    const aaSigner: ERC4337EthersSigner = this.aaProvider[chainId].getSigner()
    return aaSigner.smartAccountAPI
  }

  getProviderUrl(network: ChainConfig): string {
    this._logMessage('after init smartAccountConfig.networkConfig')
    this._logMessage(this.#smartAccountConfig.networkConfig)
    const networkConfig: NetworkConfig[] = this.#smartAccountConfig.networkConfig
    this._logMessage(`networkConfig state is`)
    this._logMessage(networkConfig)
    let providerUrl =
      networkConfig.find((element: NetworkConfig) => element.chainId === network.chainId)
        ?.providerUrl || ''

    if (!providerUrl) providerUrl = network.providerUrl
    return providerUrl
  }

  async getNetworkConfigValues(chainId: ChainId): Promise<NetworkConfig> {
    const networkConfigValues = await this.#smartAccountConfig.networkConfig?.find(
      (element: NetworkConfig) => element.chainId === chainId
    )
    if (!networkConfigValues) throw new Error('Could not get network config values')

    return networkConfigValues
  }

  async initializeContractsAtChain(chainId: ChainId) {
    let exist
    try {
      exist = this.contractUtils.smartWalletContract[chainId][this.DEFAULT_VERSION].getContract()
    } catch (err) {
      console.log('Instantiating chain ', chainId)
    }
    if (!exist) {
      this._logMessage('this.chainConfig')
      this._logMessage(this.chainConfig)
      const network = this.chainConfig.find((element: ChainConfig) => element.chainId === chainId)
      if (!network) return
      const providerUrl = this.getProviderUrl(network)
      this._logMessage('init at chain')
      this._logMessage(chainId)
      let walletInfo: ISmartAccount

      // if (!this.address) {
        walletInfo = (await this.getAddress({
          index: 0,
          chainId: network.chainId,
          version: this.DEFAULT_VERSION
        }))
        this.address = walletInfo.smartAccountAddress
        console.log('smart wallet address is ', this.address)
      // }

      const readProvider = new ethers.providers.JsonRpcProvider(providerUrl)
      this.contractUtils.initializeContracts(this.signer, readProvider, walletInfo, network)

      const clientConfig = await this.getNetworkConfigValues(network.chainId)

      this.signingService = new FallbackGasTankAPI(
        this.#smartAccountConfig.biconomySigningServiceUrl || '',
        clientConfig.dappAPIKey || ''
      )

      this.fallbackRelayer = new FallbackRelayer({
        dappAPIKey: clientConfig.dappAPIKey || '',
        url: this.#smartAccountConfig.relayerUrl,
        relayerServiceUrl: this.#smartAccountConfig.socketServerUrl
      })

      this.aaProvider[network.chainId] = await newProvider(
        new ethers.providers.JsonRpcProvider(providerUrl),
        {
          dappAPIKey: clientConfig.dappAPIKey || '',
          biconomySigningServiceUrl: this.#smartAccountConfig.biconomySigningServiceUrl || '',
          socketServerUrl: this.#smartAccountConfig.socketServerUrl || '',
          entryPointAddress: this.#smartAccountConfig.entryPointAddress
            ? this.#smartAccountConfig.entryPointAddress
            : network.entryPoint[network.entryPoint.length - 1].address,
          bundlerUrl: clientConfig.bundlerUrl || this.#smartAccountConfig.bundlerUrl || '',
          chainId: network.chainId,
          customPaymasterAPI: clientConfig.customPaymasterAPI,
          txServiceUrl: this.#smartAccountConfig.backendUrl
        },
        this.signer,
        this.address,
        network.wallet[network.wallet.length - 1].address,
        network.fallBackHandler[network.fallBackHandler.length - 1].address,
        network.walletFactory[network.walletFactory.length - 1].address
      )
    }
  }

  async init() {
    this.setActiveChain(this.#smartAccountConfig.activeNetworkId)

    this.owner = await this.signer.getAddress()

    const chainConfig = (await this.nodeClient.getAllSupportedChains()).data

    this.contractUtils = new ContractUtils(chainConfig)

    for (let index = 0; index < this.#smartAccountConfig.supportedNetworksIds.length; index++) {
      const network = chainConfig.find(
        (element: ChainConfig) =>
          element.chainId === this.#smartAccountConfig.supportedNetworksIds[index]
      )
      if (network) {
        this.chainConfig.push(network)
      }
    }
    await this.initializeContractsAtChain(this.#smartAccountConfig.activeNetworkId)

    this.transactionManager = new TransactionManager(this.contractUtils.getSmartAccountState())

    await this.transactionManager.initialize(this.relayer, this.nodeClient, this.contractUtils)
    return this
  }

  // Nice to have
  // Optional methods for connecting paymaster
  // Optional methods for connecting another bundler

  async sendGaslessFallbackTransaction(transactionDto: TransactionDto): Promise<TransactionResponse> {
    let { version, chainId } = transactionDto
    chainId = chainId ? chainId : this.#smartAccountConfig.activeNetworkId
    version = version ? version : this.DEFAULT_VERSION

    await this.initializeContractsAtChain(chainId)

    // create IWalletTransaction instance
    const transaction = await this.createTransaction(transactionDto)

    // create instance of SmartWallet contracts
    let walletContract = this.contractUtils.attachWalletContract(chainId, this.DEFAULT_VERSION, this.address)

    const signature = await this.signTransaction({
      version: this.DEFAULT_VERSION,
      tx: transaction,
      chainId,
      signer: this.signer
    })
    const refundInfo: IFeeRefundV1_0_0 | IFeeRefundV1_0_1 = {
      baseGas: transaction.baseGas,
      gasPrice: transaction.gasPrice,
      tokenGasPriceFactor: transaction.tokenGasPriceFactor,
      gasToken: transaction.gasToken,
      refundReceiver: transaction.refundReceiver
    }

    let execTransactionData = await walletContract.interface.encodeFunctionData('execTransaction', [
      transaction,
      refundInfo,
      signature,
    ])

    // create instance of fallbackGasTank contracts to get nonce
    let fallbackGasTank = this.contractUtils.fallbackGasTankContract[chainId][version].getContract()
    const gasTankNonce = await fallbackGasTank.getNonce(this.address)

    const isDeployed = await this.contractUtils.isDeployed(
      chainId,
      this.address
    )
    // dappIdentifier and signature will be added by signing service
    const fallbackUserOp = {
      sender: this.address,
      target: this.address,
      nonce: gasTankNonce,
      callData: execTransactionData || '',
      callGasLimit: BigNumber.from(800000), // will be updated below
      dappIdentifier: '',
      signature: ''
    }
    if (!isDeployed) {
      const network = this.chainConfig.find((element: ChainConfig) => element.chainId === chainId)
      if (!network)
      throw new Error('No Network Found for given chainid')

      const { multiSendCall, walletFactory, baseWallet } = this.getSmartAccountContext(chainId)
      const deployWalletEncodedData = await deployCounterFactualEncodedData({
        chainId: (await this.provider.getNetwork()).chainId,
        owner: await this.owner,
        txServiceUrl: this.#smartAccountConfig.backendUrl,
        index: 0
      })
      const txs = [
        {
          to: walletFactory.getAddress(),
          value: 0,
          data: deployWalletEncodedData,
          operation: 0
        },
        {
          to: this.address,
          value: 0,
          data: execTransactionData || '',
          operation: 0
        }
      ]
      const txnData = multiSendCall
        .getInterface()
        .encodeFunctionData('multiSend', [encodeMultiSend(txs)])
      console.log('txnData', txnData)

      // update fallbackUserOp with target and multiSend call data
      fallbackUserOp.target = multiSendCall.getAddress()
      fallbackUserOp.callData = txnData
    }


    console.log('fallbackUserOp before', fallbackUserOp)
    // send fallback user operation to signing service to get signature and dappIdentifier
    const signingServiceResponse = await this.signingService.getDappIdentifierAndSign(
      fallbackUserOp
    )
    fallbackUserOp.dappIdentifier = signingServiceResponse.dappIdentifier
    fallbackUserOp.signature = signingServiceResponse.signature
    console.log('fallbackUserOp after', fallbackUserOp)

    const handleFallBackData = await fallbackGasTank.populateTransaction.handleFallbackUserOp(fallbackUserOp)

    const rawTrx: RawTransactionType = {
      to: fallbackGasTank.address, // gas tank address
      data: handleFallBackData.data, // populateTransaction by fallbackGasTank contract handleFallbackUserop
      value: 0, // tx value
      chainId: chainId
    }
    const signedTx: SignedTransaction = {
      rawTx: rawTrx,
      tx: transaction
    }
    const state = await this.contractUtils.getSmartAccountState()
    const relayTrx: RelayTransaction = {
      signedTx,
      config: state,
      context: this.getSmartAccountContext(chainId)
    }
    const relayResponse = await this.fallbackRelayer.relay(relayTrx, this)
    return relayResponse
  }

  /**
   * @description this function will make complete transaction data for updateImplementationTrx
   * @param chainId 
   * @returns 
   */

  async updateImplementationTrx(chainId: ChainId): Promise<Transaction>{
    const isWalletDeployed = await this.isDeployed(chainId)
    if ( isWalletDeployed ){
      const chainInfo = this.chainConfig.find((element: ChainConfig) => element.chainId === chainId)
      if ( !chainInfo ){
        throw new Error('No ChainInfo Found')
      }
      const latestImpAddress = chainInfo.wallet[chainInfo.wallet.length - 1].address
      const walletsImpAddress = await this.contractUtils.getSmartAccountState().implementationAddress
      if ( latestImpAddress !== walletsImpAddress ){
        const updateImplementationCallData = await updateImplementationEncodedData(latestImpAddress)
        return {to: this.address, value: BigNumber.from(0), data: updateImplementationCallData}
      }
    }
    return {to:this.address, value:0, data: '0x'}
  }

  /**
   * @description this function will make complete transaction data for updateFallBackHandlerTrx
   * @param chainId 
   * @returns 
   */
  async updateFallBackHandlerTrx(chainId: ChainId): Promise<Transaction>{
    const isWalletDeployed = await this.isDeployed(chainId)
    if ( isWalletDeployed ){
      const chainInfo = this.chainConfig.find((element: ChainConfig) => element.chainId === chainId)
      if ( !chainInfo ){
        throw new Error('No ChainInfo Found')
      }
      const latestfallBackHandlerAddress = chainInfo.fallBackHandler[chainInfo.fallBackHandler.length - 1].address
      const walletInfo = await this.contractUtils.getSmartAccountState()
      const implementationAddress = walletInfo.implementationAddress
      const fallBackHandlerAddress = walletInfo.fallbackHandlerAddress

      if ( latestfallBackHandlerAddress !== fallBackHandlerAddress ){
        const fallbackHandlerCallData = await fallbackHandlerEncodedData(latestfallBackHandlerAddress)
        return {to: this.address, value: BigNumber.from(0), data: fallbackHandlerCallData}
      }
    }
    return {to:this.address, value:0, data: '0x'}
  }

  /**
   * @description this function will let dapp to update Base wallet Implemenation to Latest
   * @returns 
   */
  public async updateFallbackHandler(): Promise<TransactionResponse> {
    const chainId = this.#smartAccountConfig.activeNetworkId
    const fallbackHandlerTrx = await this.updateFallBackHandlerTrx(this.#smartAccountConfig.activeNetworkId)
    await this.initializeContractsAtChain(chainId)
    const aaSigner = this.aaProvider[chainId].getSigner()
    const response = await aaSigner.sendTransaction(
      fallbackHandlerTrx,
      false
    )
    return response
  }

  /**
   * @description this function will let dapp to update FallBackHandler to Latest
   * @returns 
   */
  public async updateImplementation():Promise<TransactionResponse> {
    const chainId = this.#smartAccountConfig.activeNetworkId
    const updateImplTrx = await this.updateImplementationTrx(this.#smartAccountConfig.activeNetworkId)
    await this.initializeContractsAtChain(chainId)
    const aaSigner = this.aaProvider[chainId].getSigner()
    const response = await aaSigner.sendTransaction(
      updateImplTrx,
      false
    )
    return response
  }

  public async sendGaslessTransaction(
    transactionDto: TransactionDto,
    // isUpdateImpTrx?: Boolean
  ): Promise<TransactionResponse> {

    let isFallbackEnabled = false
    try {
      const { data } = await this.nodeClient.isFallbackEnabled()
      isFallbackEnabled = data.enable_fallback_flow
      console.log('isFallbackEnabled')
      console.log(data.enable_fallback_flow)
    } catch (error) {
      console.error('isFallbackEnabled', error)
    }

    if (isFallbackEnabled){
      return this.sendGaslessFallbackTransaction(transactionDto)
    }

    let { version, chainId } = transactionDto
    chainId = chainId ? chainId : this.#smartAccountConfig.activeNetworkId
    version = version ? version : this.DEFAULT_VERSION
    const aaSigner = this.aaProvider[chainId].getSigner()

    await this.initializeContractsAtChain(chainId)

    const batchTrx = []
    const updateImplTrx = await this.updateImplementationTrx(chainId)
    let response
    

    // this case will run when user is making any normal trx and we have detected that the wallet is
    // not pointing to latest implementation so will merge user's trx with update Implementation Trx and 
    // Batch both trx
    //     if ( updateImplTrx.data != '0x' && !isUpdateImpTrx){

    if ( updateImplTrx.data != '0x' ){
      batchTrx.push(updateImplTrx, transactionDto.transaction)
      response = this.sendGaslessTransactionBatch({transactions: batchTrx})
    }else
    {
      // this case { if ( isUpdateImpTrx ) } will work only when user specifically wanted to just update Base wallet Implementation
      // if ( isUpdateImpTrx )
      // transactionDto.transaction = updateImplTrx
      
      response = await aaSigner.sendTransaction(
        transactionDto.transaction,
        false
      )
    }
    return response
  }

  public async sendGaslessTransactionBatch(
    transactionBatchDto: TransactionBatchDto
  ): Promise<TransactionResponse> {

    let { chainId } = transactionBatchDto
    chainId = chainId ? chainId : this.#smartAccountConfig.activeNetworkId

    let { transactions } = transactionBatchDto

    const aaSigner = this.aaProvider[chainId].getSigner()

    const updateImplTrx = await this.updateImplementationTrx(chainId)
    let response
    // whatever batch trx user make. will ensure to update Base wallet implementation if needed
    if ( updateImplTrx.data != '0x' ){
      transactions.unshift(updateImplTrx)
    }
    response = await aaSigner.sendTransactionBatch(transactions,false)
    return response
  }

  // Only to deploy wallet using connected paymaster
  // Todo : Add return type
  // Review involvement of Dapp API Key
  public async deployWalletUsingPaymaster(): Promise<TransactionResponse> {
    // can pass chainId
    const aaSigner = this.aaProvider[this.#smartAccountConfig.activeNetworkId].getSigner()
    const transaction = {
      to: ZERO_ADDRESS,
      data: '0x'
    }
    const response = await aaSigner.sendTransaction(transaction, true)
    return response
    // Todo: make sense of this response and return hash to the user
  }

  /**
   *
   * @param smartAccountVersion
   * @description // set wallet version to be able to interact with different deployed versions
   */
  async setSmartAccountVersion(smartAccountVersion: SmartAccountVersion): Promise<SmartAccount> {
    this.DEFAULT_VERSION = smartAccountVersion
    this.address = (await this.getAddress({
      index: 0,
      chainId: this.#smartAccountConfig.activeNetworkId,
      version: this.DEFAULT_VERSION
    })).smartAccountAddress
    return this
  }

  // Todo
  // Review inputs as chainId is already part of Dto
  public async getAlltokenBalances(
    balancesDto: BalancesDto,
    chainId: ChainId = this.#smartAccountConfig.activeNetworkId
  ): Promise<BalancesResponse> {
    if (!balancesDto.chainId) balancesDto.chainId = chainId
    return this.nodeClient.getAlltokenBalances(balancesDto)
  }

  // Todo
  // Review inputs as chainId is already part of Dto
  public async getTotalBalanceInUsd(
    balancesDto: BalancesDto,
    chainId: ChainId = this.#smartAccountConfig.activeNetworkId
  ): Promise<UsdBalanceResponse> {
    if (!balancesDto.chainId) balancesDto.chainId = chainId
    return this.nodeClient.getTotalBalanceInUsd(balancesDto)
  }

  public async getSmartAccountsByOwner(
    smartAccountByOwnerDto: SmartAccountByOwnerDto
  ): Promise<SmartAccountsResponse> {
    return this.nodeClient.getSmartAccountsByOwner(smartAccountByOwnerDto)
  }

  //Todo add description
  public async getTransactionByAddress(
    chainId: number,
    address: string
  ): Promise<SCWTransactionResponse[]> {
    return this.nodeClient.getTransactionByAddress(chainId, address)
  }

  public async getTransactionByHash(txHash: string): Promise<SCWTransactionResponse> {
    return this.nodeClient.getTransactionByHash(txHash)
  }

  // Assigns transaction relayer to this smart wallet instance
  /**
   * Assigns transaction relayer to this smart wallet instance
   * @notice Assumption is that relayer will accept calls for all supported chains
   * @param relayer Relayer client to be associated with this smart account
   * @returns this/self
   */
  async setRelayer(relayer: IRelayer): Promise<SmartAccount> {
    if (relayer === undefined) return this
    this.relayer = relayer
    //If we end up maintaining relayer instance on this then it should update all transaction managers
    //await this.transactionManager.setRelayer(relayer)
    return this
  }

  /**
   * Allows to change default active chain of the Smart Account
   * @todo make a check if chain is supported in config
   * @param chainId
   * @returns self/this
   */
  async setActiveChain(chainId: ChainId): Promise<SmartAccount> {
    this.#smartAccountConfig.activeNetworkId = chainId
    await this.initializeContractsAtChain(this.#smartAccountConfig.activeNetworkId)
    return this
  }

  /**
   *
   * @notice personal sign is used currently (// @todo Signer should be able to use _typedSignData)
   * @param tx IWalletTransaction Smart Account Transaction object prepared
   * @param chainId optional chainId
   * @returns:string Signature
   */
  async signTransaction(signTransactionDto: SignTransactionDto): Promise<string> {
    const { chainId = this.#smartAccountConfig.activeNetworkId, tx } = signTransactionDto
    const signatureType = this.#smartAccountConfig.signType
    let walletContract = this.contractUtils.attachWalletContract(chainId, this.DEFAULT_VERSION, this.address)
    let signature = '0x'
    if (signatureType === SignTypeMethod.PERSONAL_SIGN) {
      const { signer, data } = await smartAccountSignMessage(
        this.signer,
        walletContract,
        tx,
        chainId
      )
      signature += data.slice(2)
    } else {
      const { signer, data } = await smartAccountSignTypedData(
        this.signer,
        walletContract,
        tx,
        chainId
      )
      signature += data.slice(2)
    }
    return signature
    // return this.signer.signTransaction(signTransactionDto)
  }

  // This would be a implementation on user sponsorship provider
  /**
   * Prepares encoded wallet transaction, gets signature from the signer and dispatches to the blockchain using relayer
   * @param tx IWalletTransaction Smart Account Transaction object prepared
   * @param batchId optional nonce space for parallel processing
   * @param chainId optional chainId
   * @returns transactionId : transaction identifier
   */
  async sendTransaction(sendTransactionDto: SendTransactionDto): Promise<string> {
    let { chainId } = sendTransactionDto
    const { tx } = sendTransactionDto
    chainId = chainId ? chainId : this.#smartAccountConfig.activeNetworkId
    let { gasLimit } = sendTransactionDto
    const isDeployed = await this.contractUtils.isDeployed(
      chainId,
      this.address
    )
    const rawTx: RawTransactionType = {
      to: tx.to,
      data: tx.data,
      value: 0, // review
      chainId: chainId
    }

    const transaction: ExecTransaction = {
      to: tx.to,
      value: tx.value,
      data: tx.data,
      operation: tx.operation,
      targetTxGas: tx.targetTxGas
    }

    const refundInfo: IFeeRefundV1_0_0 | IFeeRefundV1_0_1 = {
      baseGas: tx.baseGas,
      gasPrice: tx.gasPrice,
      tokenGasPriceFactor: tx.tokenGasPriceFactor,
      gasToken: tx.gasToken,
      refundReceiver: tx.refundReceiver
    }

    let walletContract = this.contractUtils.attachWalletContract(chainId, this.DEFAULT_VERSION, this.address)

    const signature = await this.signTransaction({
      version: this.DEFAULT_VERSION,
      tx,
      chainId,
      signer: this.signer
    })

    const execTransaction = await walletContract.populateTransaction.execTransaction(
      transaction,
      refundInfo,
      signature
    )

    rawTx.to = this.address
    rawTx.data = execTransaction.data

    const state = await this.contractUtils.getSmartAccountState()

    const signedTx: SignedTransaction = {
      rawTx,
      tx
    }
    const relayTrx: RelayTransaction = {
      signedTx,
      config: state,
      context: this.getSmartAccountContext(chainId)
    }
    if (gasLimit) {
      relayTrx.gasLimit = gasLimit
    }
    if (!isDeployed) {
      gasLimit = {
        hex: '0x1E8480',
        type: 'hex'
      }
      relayTrx.gasLimit = gasLimit
    }
    const relayResponse: RelayResponse = await this.relayer.relay(relayTrx, this)
    if (relayResponse.transactionId) {
      return relayResponse.transactionId
    }
    return ''
  }

  async sendSignedTransaction(sendSignedTransactionDto: SendSignedTransactionDto): Promise<string> {
    let { chainId } = sendSignedTransactionDto
    const { tx, signature } = sendSignedTransactionDto
    chainId = chainId ? chainId : this.#smartAccountConfig.activeNetworkId
    let { gasLimit } = sendSignedTransactionDto
    const isDeployed = await this.contractUtils.isDeployed(
      chainId,
      this.address
    )
    const rawTx: RawTransactionType = {
      to: tx.to,
      data: tx.data,
      value: 0,
      chainId: chainId
    }

    const transaction: ExecTransaction = {
      to: tx.to,
      value: tx.value,
      data: tx.data,
      operation: tx.operation,
      targetTxGas: tx.targetTxGas
    }

    const refundInfo: IFeeRefundV1_0_0 | IFeeRefundV1_0_1 = {
      baseGas: tx.baseGas,
      gasPrice: tx.gasPrice,
      tokenGasPriceFactor: tx.tokenGasPriceFactor,
      gasToken: tx.gasToken,
      refundReceiver: tx.refundReceiver
    }

    let walletContract = this.contractUtils.attachWalletContract(chainId, this.DEFAULT_VERSION, this.address)

    const execTransaction = await walletContract.populateTransaction.execTransaction(
      transaction,
      refundInfo,
      signature
    )

    rawTx.to = this.address
    rawTx.data = execTransaction.data

    const state = await this.contractUtils.getSmartAccountState()

    const signedTx: SignedTransaction = {
      rawTx,
      tx
    }
    const relayTrx: RelayTransaction = {
      signedTx,
      config: state,
      context: this.getSmartAccountContext(chainId)
    }
    if (gasLimit) {
      relayTrx.gasLimit = gasLimit
    }
    // todo : review gasLimit passed to relay endpoint
    if (!isDeployed) {
      gasLimit = {
        hex: '0x1E8480',
        type: 'hex'
      }
      relayTrx.gasLimit = gasLimit
    }
    const relayResponse: RelayResponse = await this.relayer.relay(relayTrx, this)
    console.log('relayResponse')
    console.log(relayResponse)
    if (relayResponse.transactionId) {
      return relayResponse.transactionId
    }
    return ''
  }

  // Get Fee Options from relayer and make it available for display
  // We can also show list of transactions to be processed (decodeContractCall)
  /**
   *
   * @param prepareRefundTransactionDto
   */
  async prepareRefundTransaction(
    prepareRefundTransactionDto: PrepareRefundTransactionDto
  ): Promise<FeeQuote[]> {
    let { version, batchId = 1, chainId } = prepareRefundTransactionDto
    const { transaction } = prepareRefundTransactionDto
    chainId = chainId ? chainId : this.#smartAccountConfig.activeNetworkId
    version = version ? version : this.DEFAULT_VERSION
    return this.transactionManager.prepareRefundTransaction({
      chainId,
      version,
      transaction,
      batchId
    })
  }

  // Get Fee Options from relayer and make it available for display
  // We can also show list of transactions to be processed (decodeContractCall)
  /**
   *
   * @param prepareRefundTransactionsDto
   */
  // TODO: Rename method to getFeeOptionsForBatch
  async prepareRefundTransactionBatch(
    prepareRefundTransactionsDto: PrepareRefundTransactionsDto
  ): Promise<FeeQuote[]> {
    let { version, batchId = 1, chainId } = prepareRefundTransactionsDto
    const { transactions } = prepareRefundTransactionsDto

    chainId = chainId ? chainId : this.#smartAccountConfig.activeNetworkId
    version = version ? version : this.DEFAULT_VERSION
    return this.transactionManager.prepareRefundTransactionBatch({
      version,
      chainId,
      batchId,
      transactions
    })
  }

  // Other helpers go here for pre build (feeOptions and quotes from relayer) , build and execution of refund type transactions
  /**
   * Prepares compatible IWalletTransaction object based on Transaction Request
   * @todo Rename based on other variations to prepare transaction
   * @notice This transaction is with fee refund (smart account pays using it's own assets accepted by relayers)
   * @param refundTransactionDto
   * @returns
   */
  async createRefundTransaction(
    refundTransactionDto: RefundTransactionDto
  ): Promise<IWalletTransaction> {
    let { version, batchId = 1, chainId } = refundTransactionDto
    const { transaction, feeQuote } = refundTransactionDto
    chainId = chainId ? chainId : this.#smartAccountConfig.activeNetworkId
    version = version ? version : this.DEFAULT_VERSION
    return this.transactionManager.createRefundTransaction({
      version,
      transaction,
      batchId,
      chainId,
      feeQuote
    })
  }

  /**
   * Prepares compatible IWalletTransaction object based on Transaction Request
   * @todo Rename based on other variations to prepare transaction
   * @notice This transaction is without fee refund (gasless)
   * @param transactionDto
   * @returns
   */
  // Todo : Marked for deletion
  async createTransaction(transactionDto: TransactionDto): Promise<IWalletTransaction> {
    let { version, batchId = 1, chainId } = transactionDto
    const { transaction } = transactionDto

    chainId = chainId ? chainId : this.#smartAccountConfig.activeNetworkId
    version = version ? version : this.DEFAULT_VERSION
    return this.transactionManager.createTransaction({ chainId, version, batchId, transaction })
  }

  /**
   * Prepares compatible IWalletTransaction object based on Transaction Request
   * @todo Write test case and limit batch size based on test results in scw-contracts
   * @notice This transaction is without fee refund (gasless)
   * @param transaction
   * @param batchId
   * @param chainId
   * @returns
   */
  // Todo: Marked for deletion
  async createTransactionBatch(
    transactionBatchDto: TransactionBatchDto
  ): Promise<IWalletTransaction> {
    let { version, batchId = 1, chainId } = transactionBatchDto
    const { transactions } = transactionBatchDto

    chainId = chainId ? chainId : this.#smartAccountConfig.activeNetworkId
    version = version ? version : this.DEFAULT_VERSION
    return this.transactionManager.createTransactionBatch({
      version,
      transactions,
      chainId,
      batchId
    })
  }

  /**
   * Prepares compatible IWalletTransaction object based on Transaction Request
   * @todo Rename based on other variations to prepare transaction
   * @notice This transaction is with fee refund (smart account pays using it's own assets accepted by relayers)
   * @param refundTransactionBatchDto
   * @returns
   */
  async createRefundTransactionBatch(
    refundTransactionBatchDto: RefundTransactionBatchDto
  ): Promise<IWalletTransaction> {
    let { version, batchId = 1, chainId } = refundTransactionBatchDto
    const { transactions, feeQuote } = refundTransactionBatchDto
    chainId = chainId ? chainId : this.#smartAccountConfig.activeNetworkId
    version = version ? version : this.DEFAULT_VERSION
    return this.transactionManager.createRefundTransactionBatch({
      version,
      transactions,
      chainId,
      batchId,
      feeQuote
    })
  }

  async prepareDeployAndPayFees(chainId?: ChainId) {
    chainId = chainId ? chainId : this.#smartAccountConfig.activeNetworkId
    return this.transactionManager.prepareDeployAndPayFees(chainId, this.DEFAULT_VERSION)
  }

  // Onboarding scenario where assets inside counterfactual smart account pays for it's deployment
  async deployAndPayFees(chainId: ChainId, feeQuote: FeeQuote): Promise<string> {
    chainId = chainId ? chainId : this.#smartAccountConfig.activeNetworkId
    const transaction = await this.transactionManager.deployAndPayFees(
      chainId,
      this.DEFAULT_VERSION,
      feeQuote
    )
    const txHash = await this.sendTransaction({ tx: transaction })
    return txHash
  }

  // Todo: sendSignedTransaction (only applies for Refund transaction )

  /**
   *
   * @param chainId optional chainId
   * @returns Smart Wallet Contract instance attached with current smart account address (proxy)
   */
  smartAccount(chainId?: ChainId): SmartWalletContract {
    chainId = chainId ? chainId : this.#smartAccountConfig.activeNetworkId
    const smartWallet = this.contractUtils.smartWalletContract[chainId][this.DEFAULT_VERSION]
    const address = this.address
    smartWallet.getContract().attach(address)
    return smartWallet
  }

  /**
   *
   * @param chainId optional chainId
   * @returns Smart Wallet Factory instance for requested chainId
   */
  factory(chainId?: ChainId): SmartWalletFactoryContract {
    chainId = chainId ? chainId : this.#smartAccountConfig.activeNetworkId
    return this.contractUtils.smartWalletFactoryContract[chainId][this.DEFAULT_VERSION]
  }

  multiSend(chainId?: ChainId): MultiSendContract {
    chainId = chainId ? chainId : this.#smartAccountConfig.activeNetworkId
    return this.contractUtils.multiSendContract[chainId][this.DEFAULT_VERSION]
  }

  // Note: expose getMultiSend(), getMultiSendCall()

  // TODO
  // Note: get Address method should not be here as we are passing smart account state
  // Marked for deletion
  async getAddress(
    addressForCounterFactualWalletDto: AddressForCounterFactualWalletDto
  ): Promise<ISmartAccount> {
    
    const { index, chainId } = addressForCounterFactualWalletDto

    const walletInfo = await getWalletInfo({
      chainId,
      owner: this.owner,
      txServiceUrl: this.#smartAccountConfig.backendUrl,
      index
    })

    console.log('walletInfo ', walletInfo);

    this.address = walletInfo.smartAccountAddress

    const smartAccountState = {
      chainId: chainId,
      version: walletInfo.version,
      address: walletInfo.smartAccountAddress,
      owner: this.owner,
      isDeployed: walletInfo.isDeployed, // could be set as state in init
      entryPointAddress: walletInfo.entryPointAddress,
      implementationAddress: walletInfo.implementationAddress,
      fallbackHandlerAddress: walletInfo.fallBackHandlerAddress,
      factoryAddress: walletInfo.factoryAddress
    }
    this.contractUtils.setSmartAccountState(smartAccountState)

    return walletInfo
  }

  /**
   * Allows one to check if the smart account is already deployed on requested chainOd
   * @review
   * @notice the check is made on Wallet Factory state with current address in Smart Account state
   * @param chainId optional chainId : Default is current active
   * @returns
   */
  async isDeployed(chainId: ChainId): Promise<boolean> {
    chainId = chainId ? chainId : this.#smartAccountConfig.activeNetworkId
    return await this.contractUtils.isDeployed(chainId, this.address)
  }

  /**
   * @review for owner
   * @param chainId requested chain : default is active chain
   * @returns object containing infromation (owner, relevant contract addresses, isDeployed) about Smart Account for requested chain
   */
  async getSmartAccountState(chainId?: ChainId): Promise<SmartAccountState> {
    chainId = chainId ? chainId : this.#smartAccountConfig.activeNetworkId
    return this.contractUtils.getSmartAccountState()
  }

  //
  /**
   * Serves smart contract instances associated with Smart Account for requested ChainId
   * Context is useful when relayer is deploying a wallet
   * @param chainId requested chain : default is active chain
   * @returns object containing relevant contract instances
   */
  getSmartAccountContext(
    // smartAccountVersion: SmartAccountVersion = this.DEFAULT_VERSION,
    chainId?: ChainId
  ): SmartAccountContext {
    chainId = chainId ? chainId : this.#smartAccountConfig.activeNetworkId

    const context: SmartAccountContext = this.contractUtils.getSmartAccountContext(
      chainId,
      this.DEFAULT_VERSION
    )
    return context
  }
}

// Current default config
// TODO/NOTE : Goerli and Mumbai as test networks and remove others
export const DefaultSmartAccountConfig: SmartAccountConfig = {
  activeNetworkId: ChainId.POLYGON_MUMBAI, //Update later
  supportedNetworksIds: [
    ChainId.GOERLI,
    ChainId.POLYGON_MUMBAI,
    ChainId.POLYGON_MAINNET,
    ChainId.BSC_TESTNET
  ],
  signType: SignTypeMethod.EIP712_SIGN,
  backendUrl: 'https://sdk-backend.staging.biconomy.io/v1',
  relayerUrl: 'https://sdk-relayer.staging.biconomy.io/api/v1/relay',
  socketServerUrl: 'wss://sdk-testing-ws.staging.biconomy.io/connection/websocket',
  bundlerUrl: 'https://sdk-relayer.staging.biconomy.io/api/v1/relay',
  biconomySigningServiceUrl: 'https://paymaster-signing-service.staging.biconomy.io/api/v1/sign',
  // TODO : has to be public provider urls (local config / backend node)
  networkConfig: [
    {
      chainId: ChainId.GOERLI,
      providerUrl: 'https://eth-goerli.alchemyapi.io/v2/lmW2og_aq-OXWKYRoRu-X6Yl6wDQYt_2'
    },
    {
      chainId: ChainId.POLYGON_MUMBAI,
      providerUrl: 'https://polygon-mumbai.g.alchemy.com/v2/Q4WqQVxhEEmBYREX22xfsS2-s5EXWD31'
    },
    {
      chainId: ChainId.BSC_TESTNET,
      providerUrl:
        'https://wandering-broken-tree.bsc-testnet.quiknode.pro/7992da20f9e4f97c2a117bea9af37c1c266f63ec/'
    },
    {
      chainId: ChainId.POLYGON_MAINNET,
      providerUrl: 'https://polygon-mainnet.g.alchemy.com/v2/6Tn--QDkp1vRBXzRV3Cc8fLXayr5Yoij'
    }
  ],
  debug: false
}

export default SmartAccount
