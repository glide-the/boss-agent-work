import { JsonRpcEndpoint } from './json-rpc-endpoint';
import type { JsonRpcMessage } from '../types/native';

type Transport = ConstructorParameters<typeof JsonRpcEndpoint>[0];

export class NativeJsonRpcBridge extends JsonRpcEndpoint {
  constructor(transport: Transport, handlerObject: object, options: { onMoveMouseError?: (error: unknown, params: unknown) => void } = {}) {
    super(transport);
    this.registerRequestHandlerObject(handlerObject);
    this.addEventListener('moveMouse', (params) => {
      Promise.resolve((handlerObject as any).moveMouse?.(params)).catch((error) => options.onMoveMouseError?.(error, params));
    });
  }

  ping(): Promise<unknown> {
    return this.sendRequest('ping');
  }

  sendCdpEvent(event: unknown): void {
    this.sendNotification('onCDPEvent', event);
  }

  sendDownloadChange(change: unknown): void {
    this.sendNotification('onDownloadChange', change);
  }
}
