export interface JsonRpcRequest<TParams = unknown> {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: TParams;
}

export interface JsonRpcSuccess<TResult = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  result: TResult;
}

export interface JsonRpcFailure {
  jsonrpc: '2.0';
  id: string | number;
  error: { code?: number | string; message: string; data?: unknown };
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcSuccess | JsonRpcFailure;

export type NativeHostChannel = 'prod' | 'dev' | 'internal';

export const NATIVE_HOSTS: Record<NativeHostChannel, string> = {
  prod: 'com.openai.codexextension',
  dev: 'com.openai.codexextension.dev',
  internal: 'com.openai.codexextension.internal',
};
