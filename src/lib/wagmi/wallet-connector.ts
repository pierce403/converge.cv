export interface WalletConnectorSelector {
  connectorId?: string;
  connectorName?: string;
}

export interface WalletConnectorDescriptor {
  id: string;
  name: string;
}

/** Explicit wallet choices must never resolve to an unrelated connector. */
export function resolveWalletConnector<T extends WalletConnectorDescriptor>(
  option: WalletConnectorSelector,
  connectors: readonly T[]
): T | undefined {
  if (option.connectorId) {
    return connectors.find((connector) => connector.id === option.connectorId);
  }
  if (option.connectorName) {
    return connectors.find((connector) => connector.name === option.connectorName);
  }
  return connectors[0];
}
