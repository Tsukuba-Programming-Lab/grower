import {GrowerRsImports, JSNIFunction} from "./types.ts";

const FUNCTIONS = "__grower_jsni_functions";

// TODO should be __grower_jsni_call
const ENTRY_POINT = "jsni_call";

type _Window = Window & typeof global & {
    [ENTRY_POINT]: (jsFuncNamePtr: number, argsPtr: number, argsCount: number) => Promise<number>;
    [FUNCTIONS]: Record<string, JSNIFunction>;
};

enum JSNIKind {
    I8 = 0,
    I16 = 1,
    I32 = 2,
    I64 = 3,
    U8 = 4,
    U16 = 5,
    U32 = 6,
    U64 = 7,
    F32 = 8,
    F64 = 9,
    Bool = 10,
    Char = 11,
    String = 12,
    VecU8 = 13,
    Null = 14,
}

export default class JavaScriptNativeInterface {

    private readonly imports: GrowerRsImports;
    private readonly memory: WebAssembly.Memory;

    constructor(imports: GrowerRsImports, memory: WebAssembly.Memory) {
        this.imports = imports;
        this.memory = memory;
    }

    init() {
        if (!(window as _Window)[FUNCTIONS]) {
            (window as _Window)[FUNCTIONS] = {};
        }

        (window as _Window)[ENTRY_POINT] = async (jsFuncNamePtr: number, argsPtr: number, argsCount: number): Promise<number> => {
            const session = new JSNIFunctionCallingSession(this.imports, this.memory, jsFuncNamePtr, argsPtr, argsCount);
            const value = await session.call();
            return value ? session.buildReturnValues(value) : -1;
        };
    }

    register(name: string, func: JSNIFunction) {
        (window as _Window)[FUNCTIONS][name] = func;
    }

}

class JSNIFunctionCallingSession {
    private imports: GrowerRsImports;
    private view: DataView;
    private arr: Uint8Array;
    private argsPtr: number;
    private argsCount: number;

    functionName: string;
    args: any[] = [];

    constructor(
        imports: GrowerRsImports,
        view: WebAssembly.Memory,
        functionNamePtr: number,
        argsPtr: number,
        argsCount: number
    ) {
        this.imports = imports;
        this.view = new DataView(view.buffer);
        this.arr = new Uint8Array(view.buffer);
        this.argsPtr = argsPtr;
        this.argsCount = argsCount;

        this.functionName = this.readString(
            this.view.getUint32(functionNamePtr, true),
            this.view.getUint32(functionNamePtr + 4, true)
        );
        this.args = this.parseArgs();
    }

    async call() {
        return (window as _Window)[FUNCTIONS][this.functionName](...this.args);
    }

    private parseArgs(): any[] {
        const args: any[] = [];
        for (let i = 0; i < this.argsCount; i++) {
            const type = this.view.getUint8(this.argsPtr + i * 16 + 8);
            switch (type) {
                case JSNIKind.I8:
                    args.push(this.view.getInt8(this.argsPtr + i * 16));
                    break;
                case JSNIKind.I16:
                    args.push(this.view.getInt16(this.argsPtr + i * 16, true));
                    break;
                case JSNIKind.I32:
                    args.push(this.view.getInt32(this.argsPtr + i * 16, true));
                    break;
                case JSNIKind.I64:
                    args.push(this.view.getBigInt64(this.argsPtr + i * 16, true));
                    break;
                case JSNIKind.U8:
                    args.push(this.view.getUint8(this.argsPtr + i * 16));
                    break;
                case JSNIKind.U16:
                    args.push(this.view.getUint16(this.argsPtr + i * 16, true));
                    break;
                case JSNIKind.U32:
                    args.push(this.view.getUint32(this.argsPtr + i * 16, true));
                    break;
                case JSNIKind.U64:
                    args.push(this.view.getBigUint64(this.argsPtr + i * 16, true));
                    break;
                case JSNIKind.F64:
                    args.push(this.view.getFloat64(this.argsPtr + i * 16, true));
                    break;
                case JSNIKind.F32:
                    args.push(this.view.getFloat32(this.argsPtr + i * 16, true));
                    break;
                case JSNIKind.Bool:
                    args.push(this.view.getUint8(this.argsPtr + i * 16) !== 0);
                    break;
                case JSNIKind.Char:
                    args.push(String.fromCharCode(this.view.getUint16(this.argsPtr + i * 16, true)));
                    break;
                case JSNIKind.String:
                    args.push(
                        this.readString(
                            this.view.getUint32(this.argsPtr + i * 16, true),
                            this.view.getUint32(this.argsPtr + i * 16 + 4, true)
                        )
                    );
                    break;
                case JSNIKind.VecU8:
                    args.push(
                        this.readVec(
                            this.view.getUint32(this.argsPtr + i * 16, true),
                            this.view.getUint32(this.argsPtr + i * 16 + 4, true)
                        )
                    );
                    break;
                case JSNIKind.Null:
                    args.push(null);
                    break;
            }
        }
        return args;
    }

    buildReturnValues(values: any[]): number {
        const size = values.length; // 16 bytes per value
        const fat_ptr = this.imports.alloc_jsni_value(size);
        const ptr = Number(fat_ptr & BigInt(0xffffffff));

        for (let i = 0; i < values.length; i++) {
            switch (typeof values[i]) {
                case "number":
                    if (Number.isInteger(values[i])) {
                        this.view.setBigInt64(ptr + i * 16, BigInt(values[i]), true);
                        this.view.setInt32(ptr + i * 16 + 8, JSNIKind.I64, true);
                    } else {
                        this.view.setFloat64(ptr + i * 16, values[i], true);
                        this.view.setInt32(ptr + i * 16 + 8, JSNIKind.F64, true);
                    }
                    break;
                case "bigint":
                    this.view.setBigInt64(ptr + i * 16, values[i], true);
                    this.view.setInt32(ptr + i * 16 + 8, JSNIKind.I64, true);
                    break;
                case "string":
                    const strBytes = new TextEncoder().encode(values[i]);
                    const strFatPtr = this.imports.alloc(strBytes.length + 1); // 1 byte for null terminator
                    const strPtr = Number(strFatPtr & BigInt(0xffffffff));
                    this.arr.set(strBytes, strPtr);
                    this.arr[strPtr + strBytes.length] = 0; // null terminator
                    this.view.setUint32(ptr + i * 16, Number(strFatPtr >> BigInt(32)), true);
                    this.view.setInt32(ptr + i * 16 + 8, JSNIKind.String, true);
                    break;
                case "object":
                    if (values[i] instanceof Uint8Array) {
                        const vecBytes = values[i];
                        const vecFatPtr = this.imports.alloc(vecBytes.length);
                        const vecPtr = Number(vecFatPtr & BigInt(0xffffffff));
                        this.arr.set(vecBytes, vecPtr);
                        this.view.setUint32(ptr + i * 16, Number(vecFatPtr >> BigInt(32)), true);
                        this.view.setInt32(ptr + i * 16 + 8, JSNIKind.VecU8, true);
                    } else if (values[i] === null) {
                        // this.view.setUint32(ptr + i * 16, 0, true);
                        this.view.setInt32(ptr + i * 16 + 8, JSNIKind.Null, true);
                    } else {
                        throw new Error(`Unsupported object type: ${typeof values[i]}`);
                    }
                    break;
            }
        }

        return Number(fat_ptr >> BigInt(32));
    }

    private readString(ptr: number, len: number): string {
        return new TextDecoder().decode(this.arr.slice(ptr, ptr + len));
    }

    private readVec(ptr: number, len: number): Uint8Array {
        return this.arr.slice(ptr, ptr + len);
    }
}