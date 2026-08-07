export interface Chunk {
  path: string;
  chunkIndex: number;
  startLine: number;
  endLine: number;
  content: string;
}