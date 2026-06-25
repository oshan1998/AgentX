export function resolveVertexProject(): string {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  if (!projectId) {
    throw new Error("GOOGLE_CLOUD_PROJECT is required for Vertex AI.");
  }
  return projectId;
}

const NON_REGIONAL_VERTEX_LOCATIONS = new Set(["global", "us", "eu"]);

export function resolveVertexLocation(): string {
  return process.env.GOOGLE_CLOUD_LOCATION?.trim() || "us-central1";
}

/** Regional endpoint for Vertex RAG corpus APIs (not supported on global/us/eu). */
export function resolveVertexRagLocation(): string {
  const ragLocation = process.env.VERTEX_RAG_LOCATION?.trim();
  if (ragLocation) return ragLocation;

  const location = resolveVertexLocation();
  if (NON_REGIONAL_VERTEX_LOCATIONS.has(location)) return "us-central1";
  return location;
}
