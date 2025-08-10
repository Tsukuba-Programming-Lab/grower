/**
 * st_mode field masks of stat structure.
 *
 * @see https://manpages.ubuntu.com/manpages/focal/ja/man2/stat.2.html
 */
export enum StModeFileType {
    /** * File type and mode bits. */
    S_IFMT = 0o170000,
    /** Socket */
    S_IFSOCK = 0o140000,
    /** Symbolic link */
    S_IFLNK = 0o120000,
    /** Regular file */
    S_IFREG = 0o100000,
    /** Block device */
    S_IFBLK = 0o060000,
    /** Directory */
    S_IFDIR = 0o040000,
    /** Character device */
    S_IFCHR = 0o020000,
    /** FIFO */
    S_IFIFO = 0o010000,
}

/**
 * File descriptor reserved for standard input, output, and error.
 *
 * @see https://manpages.ubuntu.com/manpages/focal/ja/man2/open.2.html
 */
export enum FdReserved {
    /** Standard input file descriptor */
    IN,
    /** Standard output file descriptor */
    OUT,
    /** Standard error file descriptor */
    ERR,
}

export default class Sys {

    // @ts-ignore
    private opfsRoot: FileSystemDirectoryHandle;
    private readonly fdMap: Record<number, FileSystemHandle> = {};
    private readonly stdOutHandler: (text: string) => void;
    private readonly stdErrHandler: (text: string) => void;

    constructor(stdOut: (text: string) => void, stdErr: (text: string) => void) {
        this.stdOutHandler = stdOut;
        this.stdErrHandler = stdErr;
    }

    /**
     * Initializes the file system by getting the OPFS root directory.
     */
    async init(): Promise<void> {
        const opfsRoot = await navigator.storage.getDirectory();
        if (!this.opfsRoot) {
            throw new Error("Failed to get OPFS root directory");
        }

        this.opfsRoot = opfsRoot;
    }

    /**
     * Checks the status of a file or directory at the given path.
     * @param path The path to the file or directory.
     * @see https://manpages.ubuntu.com/manpages/focal/ja/man2/stat.2.html
     */
    async stat(path: string): Promise<number[]> {
        const stat = {
            st_dev: 0, // Device ID
            st_ino: 0, // Inode number
            st_mode: 0, // File type and mode
            st_nlink: 1, // Number of hard links
            st_uid: 0, // User ID of owner
            st_gid: 0, // Group ID of owner
            st_rdev: 0, // Device ID (if special file)
            st_size: 0, // Size in bytes
            st_blksize: 4096, // Block size for filesystem I/O
            st_blocks: 0, // Number of blocks allocated
        };

        try {
            const fileHandle = await this.getFileHandle(this.getFileNameFromPath(path));
            if (!fileHandle) {
                return [-1];
            }

            const file = await (fileHandle as FileSystemFileHandle).getFile();
            stat.st_mode = StModeFileType.S_IFREG;
            stat.st_size = file.size ?? 0;

        }  catch(e: unknown) {
            if ((e as Error).name === 'TypeMismatchError') {
                stat.st_mode = StModeFileType.S_IFDIR;
            } else if ((e as Error).name === 'NotFoundError') {
                return [-1];
            }
        }

        return Object.values(stat);
    }

    /**
     * Gets the file descriptor for the given path.
     * @param path The path to the file.
     * @return The file descriptor, or -1 if the file does not exist.
     * @see https://manpages.ubuntu.com/manpages/focal/ja/man2/open.2.html
     */
    async open(path: string): Promise<number> {
        const handle = await this.getFileHandle(path);

        if (!handle) {
            return -1;
        }

         const result = Object.keys(this.fdMap).length + 3;
        this.fdMap[result] = handle;

        return result;
    }

    /**
     * Closes the file descriptor.
     * @param fd The file descriptor to close.
     * @returns 0 on success, -1 on failure.
     * @see https://manpages.ubuntu.com/manpages/focal/ja/man2/close.2.html
     */
    close(fd: number): number {
        if (!(fd in this.fdMap)) {
            return -1; // Invalid file descriptor
        }
        delete this.fdMap[fd];
        return 0;
    }

    /**
     * Writes data to a file descriptor.
     * @param fd The file descriptor to write to.
     * @param b The data to write as a Uint8Array.
     * @param off The offset in the Uint8Array to start writing from.
     * @param len The number of bytes to write.
     * @return The number of bytes written, or 0 if the file descriptor is invalid.
     * @see https://manpages.ubuntu.com/manpages/focal/ja/man2/write.2.html
     * */
    async write(fd: number, b: Uint8Array, off: number, len: number): Promise<number> {
        const data = b.subarray(off, off + len);

        if (fd === FdReserved.OUT) {
            this.stdOutHandler(new TextDecoder().decode(data));
            return data.length;
        } else if (fd === FdReserved.ERR) {
            this.stdErrHandler(new TextDecoder().decode(data));
            return data.length;
        }

        // TODO
        // const handle = (window as any)[FS_FDMAP][fd] as FileSystemFileHandle;
        // const file = await handle.getFile();
        // const data = Array.from(new Uint8Array(await file.arrayBuffer()));

        return 0;
    }

    private async getFileHandle(path: string): Promise<FileSystemHandle | undefined> {
        if (!this.opfsRoot) {
            return undefined
        }

        const dirHandle = await this.getLastDirectory(path);
        if (!dirHandle) {
            return undefined;
        }

        return await dirHandle.getFileHandle(this.getFileNameFromPath(path));
    }

    private async getLastDirectory(path: string): Promise<FileSystemDirectoryHandle | undefined> {
        const dirs = path.startsWith("/")
            ? path.substring(1).split("/").slice(0, -1)
            : path.split("/").slice(0, -1);
        if (dirs.length === 0) {
            return this.opfsRoot;
        }

        let parentDir = this.opfsRoot;
        for (let dir of dirs) {
            try {
                parentDir = await parentDir.getDirectoryHandle(dir);
            } catch (e: unknown) {
                return undefined;
            }
        }

        return parentDir;
    }

    private getFileNameFromPath(path: string): string {
        return path.split("/").pop()!;
    }

}