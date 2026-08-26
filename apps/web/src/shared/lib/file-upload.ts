/** XHR (not fetch) PUT to a presigned S3 URL — fetch can't report upload progress. */
export function uploadFileToS3(
  uploadUrl: string,
  file: File,
  opts: { onProgress?: (progress: number) => void; signal?: AbortSignal } = {}
): Promise<void> {
  const { onProgress, signal } = opts
  const xhr = new XMLHttpRequest()

  return new Promise<void>((resolve, reject) => {
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    })

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`Upload failed (${xhr.status})`))
    })
    xhr.addEventListener("error", () =>
      reject(new Error("Network error during upload"))
    )
    xhr.addEventListener("abort", () => reject(new Error("Upload aborted")))
    signal?.addEventListener("abort", () => xhr.abort())

    xhr.open("PUT", uploadUrl)
    xhr.setRequestHeader("Content-Type", file.type)
    xhr.send(file)
  })
}
