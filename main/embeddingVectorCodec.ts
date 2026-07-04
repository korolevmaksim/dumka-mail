// Embedding vectors are persisted as little-endian Float32 blobs (vector_blob).
// Legacy rows still carry JSON text in vector_json; readers fall back to it until
// the background migration in the semantic search worker rewrites them.
// The conversion is one-way: writers blank vector_json, so rolling back to a
// pre-blob build leaves semantic search silently empty (old readers parse '' as
// an empty vector and every score is 0) until the user reindexes with
// "clear current". Rollback support was traded for not storing every vector
// twice (~39KB of JSON per 3072-dim row).

export function encodeEmbeddingVector(vector: ArrayLike<number>): Buffer {
  return Buffer.from(new Float32Array(vector).buffer);
}

export function decodeEmbeddingVector(buffer: Buffer): Float32Array {
  const floatCount = Math.floor(buffer.byteLength / Float32Array.BYTES_PER_ELEMENT);
  if (floatCount === 0) return new Float32Array(0);
  const byteLength = floatCount * Float32Array.BYTES_PER_ELEMENT;
  // better-sqlite3 blobs can land at byteOffsets that are not 4-aligned inside
  // Node's Buffer pool, and Float32Array views throw on misaligned offsets.
  if (buffer.byteOffset % Float32Array.BYTES_PER_ELEMENT === 0) {
    return new Float32Array(buffer.buffer, buffer.byteOffset, floatCount);
  }
  return new Float32Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + byteLength));
}

export function decodeStoredEmbeddingVector(vectorBlob: unknown, vectorJson: unknown): Float32Array {
  if (Buffer.isBuffer(vectorBlob) && vectorBlob.byteLength >= Float32Array.BYTES_PER_ELEMENT) {
    return decodeEmbeddingVector(vectorBlob);
  }
  if (typeof vectorJson !== 'string' || !vectorJson) return new Float32Array(0);
  try {
    const parsed = JSON.parse(vectorJson);
    return Float32Array.from(Array.isArray(parsed) ? parsed : []);
  } catch {
    // Malformed legacy vector_json (deliberately preserved by the migration)
    // degrades to an empty vector that scores 0 instead of failing the scan.
    return new Float32Array(0);
  }
}

export function decodeStoredEmbeddingVectorAsNumbers(vectorBlob: unknown, vectorJson: unknown): number[] {
  if (Buffer.isBuffer(vectorBlob) && vectorBlob.byteLength >= Float32Array.BYTES_PER_ELEMENT) {
    return Array.from(decodeEmbeddingVector(vectorBlob));
  }
  return JSON.parse((typeof vectorJson === 'string' && vectorJson) || '[]');
}
