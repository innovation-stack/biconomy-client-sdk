import { ChainId, SmartAccountConfig, SignTypeMethod } from "@biconomy/core-types";

export const ProductionConfig: SmartAccountConfig = {
    activeNetworkId: ChainId.MAINNET,
    supportedNetworksIds: [
      ChainId.GOERLI,
      ChainId.POLYGON_MUMBAI,
      ChainId.POLYGON_MAINNET,
      ChainId.BSC_TESTNET,
      ChainId.MAINNET
    ],
    signType: SignTypeMethod.EIP712_SIGN,
    backendUrl: 'https://sdk-backend.prod.biconomy.io/v1',
    relayerUrl: 'https://sdk-relayer.prod.biconomy.io/api/v1/relay',
    socketServerUrl: 'wss://sdk-testing-ws.prod.biconomy.io/connection/websocket',
    bundlerUrl: 'https://sdk-relayer.prod.biconomy.io/api/v1/relay',
    biconomySigningServiceUrl: 'https://paymaster-signing-service.prod.biconomy.io/api/v1/sign',
    networkConfig: [
      {
        chainId: ChainId.GOERLI,
        providerUrl: 'https://eth-goerli.alchemyapi.io/v2/lmW2og_aq-OXWKYRoRu-X6Yl6wDQYt_2'
      },
      {
        chainId: ChainId.MAINNET,
        providerUrl: 'https://eth-mainnet.g.alchemy.com/v2/oIGKtCZoQ2AQUt0sfD46oXB6mv47u9yy'
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
  }

export const StagingConfig: SmartAccountConfig = {
    activeNetworkId: ChainId.POLYGON_MUMBAI,
    supportedNetworksIds: [
      ChainId.GOERLI,
      ChainId.POLYGON_MUMBAI,
      ChainId.BSC_TESTNET
    ],
    signType: SignTypeMethod.EIP712_SIGN,
    backendUrl: 'https://sdk-backend.staging.biconomy.io/v1',
    relayerUrl: 'https://sdk-relayer.staging.biconomy.io/api/v1/relay',
    socketServerUrl: 'wss://sdk-testing-ws.staging.biconomy.io/connection/websocket',
    bundlerUrl: 'https://sdk-relayer.staging.biconomy.io/api/v1/relay',
    biconomySigningServiceUrl: 'https://paymaster-signing-service.staging.biconomy.io/api/v1/sign',
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
      }
    ],
}

export const DevelopmentConfig: SmartAccountConfig = {
    activeNetworkId: ChainId.POLYGON_MUMBAI,
    supportedNetworksIds: [
      ChainId.GOERLI,
      ChainId.POLYGON_MUMBAI,
      ChainId.BSC_TESTNET
    ],
    signType: SignTypeMethod.EIP712_SIGN,
    backendUrl: 'https://sdk-backend.dev.biconomy.io/v1',
    relayerUrl: 'https://sdk-relayer.dev.biconomy.io/api/v1/relay',
    socketServerUrl: 'wss://sdk-testing-ws.dev.biconomy.io/connection/websocket',
    bundlerUrl: 'https://sdk-relayer.dev.biconomy.io/api/v1/relay',
    biconomySigningServiceUrl: 'https://paymaster-signing-service.dev.biconomy.io/api/v1/sign',
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
      }
    ],
}


