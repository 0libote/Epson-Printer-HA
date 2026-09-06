import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, fetchScans, type StatusResponse, type HistoryResponse } from "../lib/api";

export function useStatus(enabled = true) {
  return useQuery({
    queryKey: ["status"],
    queryFn: () => apiGet<StatusResponse>("/api/status"),
    enabled,
    refetchInterval: (query) => {
      // poll faster when jobs exist or scanner starting
      const data = query.state.data as StatusResponse | undefined;
      const hasJobs = !!(data && data.queue && data.queue.length > 0);
      const scannerStarting = !!(data && !data.scanner?.ok);
      if (hasJobs) return 2000;
      if (scannerStarting) return 3000;
      return 5000;
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 1500,
    retry: 2,
  });
}

export function useHistory(limit = 100) {
  return useQuery({
    queryKey: ["history", limit],
    queryFn: () => apiGet<HistoryResponse>(`/api/history?limit=${limit}`),
    refetchInterval: 5000,
    staleTime: 2000,
  });
}

export function useScans(limit = 100, enabled = true) {
  return useQuery({
    queryKey: ["scans", limit],
    queryFn: () => fetchScans(limit),
    enabled,
    refetchInterval: 5000,
    staleTime: 2000,
  });
}

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => apiGet<{ ok: boolean }>("/api/health"),
    refetchInterval: 15000,
  });
}
