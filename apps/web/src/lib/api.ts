import axios from "axios"
import { env } from "@/lib/env"
import { useSessionExpired } from "@/stores/session-expired"

/**
 * Base API client. better-auth manages the session cookie, so send
 * credentials; refreshes server-side, we only surface an expired session to
 * the user.
 */
export const api = axios.create({
  baseURL: env.VITE_API_URL,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
})

/**
 * A 401 on an in-page data call means the session expired; open the modal.
 * (Navigation-time 401s are caught earlier by route beforeLoad guards.)
 */
api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) useSessionExpired.getState().open()
    return Promise.reject(error)
  }
)
