import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchStatus, fetchHistory, fetchHealth, fetchScans, fetchInk, type StatusResponse } from "../lib/api";

export function useStatus(enabled = true) {
  return useQuery({
    queryKey: ["status"],
    queryFn: fetchStatus,
    enabled,
    refetchInterval: (query) => {
      // poll faster when jobs exist; idle clients stay quiet (was 2s/3s/5s hammering CUPS)
      const data = query.state.data as StatusResponse | undefined;
      const hasJobs = !!(data && data.queue && data.queue.length > 0);
      const scannerStarting = !!(data && !data.scanner?.ok);
      if (hasJobs) return 4000;
      if (scannerStarting) return 8000;
      return 15000;
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    staleTime: 5000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
    refetchOnMount: true,
  });
}

export function useHistory(limit = 100) {
  return useQuery({
    queryKey: ["history", limit],
    queryFn: fetchHistory,
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    staleTime: 8000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useScans(limit = 100, enabled = true) {
  return useQuery({
    queryKey: ["scans", limit],
    queryFn: fetchScans,
    enabled,
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    staleTime: 8000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    staleTime: 30000,
    retry: 1,
  });
}

export function useInk(enabled = true) {
  return useQuery({
    queryKey: ["ink"],
    queryFn: () => fetchInk(false),
    enabled,
    // ink changes slowly; 5 min poll keeps SNMP/IPP chatter off the LAN
    refetchInterval: 5 * 60 * 1000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
    refetchOnMount: true,
  });
}
