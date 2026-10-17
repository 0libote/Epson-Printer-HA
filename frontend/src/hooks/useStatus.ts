import { useEffect, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import {
  fetchStatus,
  fetchHistory,
  fetchHealth,
  fetchScans,
  fetchInk,
  type StatusResponse,
  type ScanSort,
} from "../lib/api";

export function useStatus(enabled = true) {
  return useQuery({
    queryKey: ["status"],
    queryFn: fetchStatus,
    enabled,
    refetchInterval: (query) => {
      // poll faster when jobs exist; idle clients stay quiet (was 2s/3s/5s hammering CUPS)
      const data = query.state.data as StatusResponse | undefined;
      const hasJobs = !!(data && data.queue && data.queue.length > 0);
      const checking = data?.status_meta?.refreshing;
      if (checking) return 2000;
      if (hasJobs) return 4000;
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

export function useHistory(limit = 100, enabled = true) {
  return useQuery({
    queryKey: ["history", limit],
    enabled,
    queryFn: () => fetchHistory(limit),
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    staleTime: 8000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useScans(
  limit = 100,
  enabled = true,
  search = "",
  sort: ScanSort = "newest",
) {
  const [debounced, setDebounced] = useState(search);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const query = useInfiniteQuery({
    queryKey: ["scans", limit, debounced, sort],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchScans(limit, pageParam, debounced, sort),
    getNextPageParam: (page) => page.next_offset ?? undefined,
    enabled,
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    staleTime: 8000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
  });
  const first = query.data?.pages[0];
  const unique = new Map(
    query.data?.pages
      .flatMap((page) => page.scans)
      .map((scan) => [scan.name, scan]) ?? [],
  );
  return {
    ...query,
    isSearching: search !== debounced,
    data: first ? { ...first, scans: [...unique.values()] } : undefined,
  };
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
