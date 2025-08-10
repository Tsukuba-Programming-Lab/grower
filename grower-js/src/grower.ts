import {GrowerRsImports} from "./types.ts";
import JavaScriptNativeInterface from "./jsni.ts";
import {initSys} from "./sys.ts";

type Options = {
    stdOutHandler: (text: string) => void;
    stdErrHandler: (text: string) => void;
}

/**
 * Grower is the main class for interacting with the Grower Rust WebAssembly module.
 */
export default class Grower {
    private readonly imports: GrowerRsImports;
    private readonly memory: WebAssembly.Memory;
    private readonly options: Options;

    private initialized = false;

    /**
     * JavaScript Native Interface for Grower.
     * @see {@link JavaScriptNativeInterface}
     */
    readonly jsni: JavaScriptNativeInterface;

    /**
     * Creates a new instance of Grower.
     * @param imports - The functions exported from grower-rs.
     * @param memory - The WebAssembly memory instance.
     * @param options - Optional configuration for Grower.
     */
    constructor(imports: GrowerRsImports, memory: WebAssembly.Memory, options: Partial<Options>) {
        this.imports = imports;
        this.memory = memory;
        this.options = this.normalizeOptions(options);

        this.jsni = new JavaScriptNativeInterface(this.imports, this.memory);
    }

    /**
     * Initializes the Grower instance.
     * @throws {Error} If Grower is already initialized.
     */
    async init() {
        if (this.initialized) {
            throw new Error("Grower is already initialized.");
        }

        await initSys(this.options.stdOutHandler, this.options.stdErrHandler);
        this.jsni.init();

        this.initialized = true;
    }

    private normalizeOptions(options: Partial<Options>): Options {
        return {
            stdOutHandler: options.stdOutHandler || ((text: string) => console.log(text)),
            stdErrHandler: options.stdErrHandler || ((text: string) => console.error(text)),
        };
    }
}