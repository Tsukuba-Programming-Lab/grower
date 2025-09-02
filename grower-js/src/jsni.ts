import {GrowerRsImports, JSNIFunction} from "./types.ts";

const FUNCTIONS = "__grower_jsni_functions";

// TODO should be __grower_jsni_call
const ENTRY_POINT = "jsni_call";

type _Window = Window & typeof global & {
    [ENTRY_POINT]: (jsFuncNamePtr: number, argsPtr: number, argsCount: number) => Promise<number>;
    [FUNCTIONS]: Record<string, JSNIFunction>;
};

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
            console.log(session);
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
        console.log(`JSNI: Calling function ${this.functionName} with args`, this.args, (window as _Window)[FUNCTIONS][this.functionName]);
        return (window as _Window)[FUNCTIONS][this.functionName](...this.args);
    }

    private parseArgs(): any[] {
        const args: any[] = [];
        for (let i = 0; i < this.argsCount; i++) {
            const type = this.view.getUint8(this.argsPtr + i * 16 + 8);
            switch (type) {
                // i8
                case 0:
                    args.push(this.view.getInt8(this.argsPtr + i * 16));
                    break;
                // i16
                case 1:
                    args.push(this.view.getInt16(this.argsPtr + i * 16, true));
                    break;
                // i32
                case 2:
                    args.push(this.view.getInt32(this.argsPtr + i * 16, true));
                    break;
                // i64
                case 3:
                    args.push(this.view.getBigInt64(this.argsPtr + i * 16, true));
                    break;
                // u8
                case 4:
                    args.push(this.view.getUint8(this.argsPtr + i * 16));
                    break;
                // u16
                case 5:
                    args.push(this.view.getUint16(this.argsPtr + i * 16, true));
                    break;
                // u32
                case 6:
                    args.push(this.view.getUint32(this.argsPtr + i * 16, true));
                    break;
                // u64
                case 7:
                    args.push(this.view.getBigUint64(this.argsPtr + i * 16, true));
                    break;
                // f32
                case 8:
                    args.push(this.view.getFloat32(this.argsPtr + i * 16, true));
                    break;
                // f64
                case 9:
                    args.push(this.view.getFloat64(this.argsPtr + i * 16, true));
                    break;
                // String
                case 10:
                    args.push(
                        this.readString(
                            this.view.getUint32(this.argsPtr + i * 16, true),
                            this.view.getUint32(this.argsPtr + i * 16 + 4, true)
                        )
                    );
                    break;
                // U8Array
                case 11:
                    args.push(
                        this.readVec(
                            this.view.getUint32(this.argsPtr + i * 16, true),
                            this.view.getUint32(this.argsPtr + i * 16 + 4, true)
                        )
                    );
                    break;
                // null
                case 13:
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
                        this.view.setInt32(ptr + i * 16 + 8, 3, true);
                    } else {
                        this.view.setFloat64(ptr + i * 16, values[i], true);
                        this.view.setInt32(ptr + i * 16 + 8, 9, true);
                    }
                    break;
                case "bigint":
                    this.view.setBigInt64(ptr + i * 16, values[i], true);
                    this.view.setInt32(ptr + i * 16 + 8, 3, true);
                    break;
                case "string":
                    const strBytes = new TextEncoder().encode(values[i]);
                    const strFatPtr = this.imports.alloc(strBytes.length + 1); // 1 byte for null terminator
                    const strPtr = Number(strFatPtr & BigInt(0xffffffff));
                    this.arr.set(strBytes, strPtr);
                    this.arr[strPtr + strBytes.length] = 0; // null terminator
                    this.view.setUint32(ptr + i * 16, Number(strFatPtr >> BigInt(32)), true);
                    this.view.setInt32(ptr + i * 16 + 8, 10, true);
                    break;
                case "object":
                    if (values[i] instanceof Uint8Array) {
                        const vecBytes = values[i];
                        const vecFatPtr = this.imports.alloc(vecBytes.length);
                        const vecPtr = Number(vecFatPtr & BigInt(0xffffffff));
                        this.arr.set(vecBytes, vecPtr);
                        this.view.setUint32(ptr + i * 16, Number(vecFatPtr >> BigInt(32)), true);
                        this.view.setInt32(ptr + i * 16 + 8, 11, true);
                    } else if (values[i] === null) {
                        this.view.setUint32(ptr + i * 16, 0, true);
                        this.view.setInt32(ptr + i * 16 + 8, 13, true);
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