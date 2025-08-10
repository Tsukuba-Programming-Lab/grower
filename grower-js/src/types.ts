export type JSNIValue = string | number | Uint8Array | null;

export type JSNIFunctionReturn = JSNIValue[] | Promise<JSNIValue[]>;
export type JSNIFunction = (...args: JSNIValue[]) => JSNIFunctionReturn;

export type GrowerRsImports = {
    alloc_jsni_value: (size: number) => bigint;
    alloc: (size: number) => bigint;
}
