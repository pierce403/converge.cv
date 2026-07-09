import { IdentifierKind, type Identifier } from '@xmtp/browser-sdk';
import { normalizeEthereumAddress } from '@/lib/utils/ethereum';

export function formatXmtpIdentifier(identifier: Identifier): string {
  if (identifier.identifierKind === IdentifierKind.Ethereum) {
    return normalizeEthereumAddress(identifier.identifier) ?? identifier.identifier;
  }
  return identifier.identifier;
}
