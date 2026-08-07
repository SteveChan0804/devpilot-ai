const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 120;
export function chunkFiles(files) {
    const chunks = [];
    for (const file of files) {
        const lines = file.content.split("\n");
        let currentContent = "";
        let startLine = 1;
        let chunkIndex = 0;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i] + "\n";
            if (currentContent.length > 0 && currentContent.length + line.length > CHUNK_SIZE) {
                chunks.push({
                    path: file.path,
                    chunkIndex,
                    startLine,
                    endLine: i,
                    content: currentContent,
                });
                chunkIndex++;
                const overlap = currentContent.slice(-CHUNK_OVERLAP);
                currentContent = overlap;
                startLine = i + 1;
            }
            currentContent += line;
        }
        if (currentContent.length > 0) {
            chunks.push({
                path: file.path,
                chunkIndex,
                startLine,
                endLine: lines.length,
                content: currentContent,
            });
        }
    }
    return chunks;
}
