import fg from "fast-glob";
import { readFile } from "node:fs/promises";
import path from "node:path";
export async function scanRepository(rootPath) {
    const files = await fg([
        "**/*.ts",
        "**/*.tsx",
        "**/*.js",
        "**/*.jsx",
        "**/*.json",
        "**/*.md",
    ], {
        cwd: rootPath,
        absolute: true,
        ignore: [
            "**/node_modules/**",
            "**/.git/**",
            "**/dist/**",
            "**/dist-test/**",
            "**/build/**",
            "**/.next/**",
            "**/coverage/**",
            "**/.env*",
            "**/*.pem",
            "**/*.key",
        ],
        onlyFiles: true,
    });
    const TypeScriptSources = new Set(files.filter((file) => /\.(ts|tsx)$/.test(file)).map((file) => file.replace(/\.(ts|tsx)$/, "")));
    const filteredFiles = files.filter((file) => {
        if (!/\.js$/.test(file))
            return true;
        return !TypeScriptSources.has(file.replace(/\.js$/, ""));
    });
    const scannedFiles = [];
    for (const file of filteredFiles) {
        const content = await readFile(file, "utf8");
        const relativePath = path.relative(rootPath, file);
        scannedFiles.push({
            path: relativePath,
            content,
        });
    }
    return scannedFiles;
}
