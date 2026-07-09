import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

export function useConnectivity(): { isOnline: boolean } {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    return NetInfo.addEventListener((state) => {
      setIsOnline(state.isConnected !== false && state.isInternetReachable !== false);
    });
  }, []);

  return { isOnline };
}

/** One-shot connectivity check outside React render (e.g. before an offline-pack download). */
export async function isOnlineNow(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return state.isConnected !== false && state.isInternetReachable !== false;
}
