export function resolveVertexProject(): string {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  if (!projectId) {
    throw new Error("GOOGLE_CLOUD_PROJECT is required for Vertex AI.");
  }
  return projectId;
}

export function resolveVertexLocation(): string {
  return process.env.GOOGLE_CLOUD_LOCATION?.trim() || "us-central1";
}
