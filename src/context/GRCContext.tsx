import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { BASELINE_SATKERS, INDICATOR_METAS } from '../data/baselineData';
import {
  DEFAULT_ADMIN_EMAIL,
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_ADMIN_USERNAME,
  DEFAULT_USER_PASSWORD,
  buildInitialSatkerUsers,
  resolveIdentifierToEmail,
} from '../data/satkerUsers';
import {
  SatkerData,
  UserProfile,
  AppConfiguration,
} from '../types/mongrc';
import {
  recalculateSatkerScores,
  calculateSummaryStats,
  extractAvailableYearsAndPeriods,
  filterSatkersByPeriod,
  canUserEditSatker,
  normalizeTextToken,
} from '../utils/grcCalculations';
import {
  DEFAULT_APP_CONFIG,
  DEFAULT_APPS_SCRIPT_URL,
  fetchConfigFromAppsScript,
  fetchSatkersFromAppsScript,
  fetchUsersFromAppsScript,
  getStoredAppsScriptUrl,
  handleCreateUserInAppsScript,
  handleDeleteUserInAppsScript,
  handleUpdateUserInAppsScript,
  pushBulkSatkersToAppsScript,
  pushSatkerUpdateToAppsScript,
  recordUserLoginInAppsScript,
  saveConfigToAppsScript,
  serializeUserToSheetAccount,
  setStoredAppsScriptUrl,
  syncUsersToAppsScript,
} from '../services/googleSheetsService';

export const PUBLIC_VIEWER_USER: UserProfile = {
  id: 'public-viewer',
  username: 'pemantau',
  email: '',
  nip: '-',
  name: 'Mode Pemantau (Publik)',
  role: 'Viewer',
  agency: 'Ditjen P2 Kemenkes RI',
  avatarInitials: 'MP',
  status: 'active',
  createdAt: '2026-01-01 00:00',
};

export const INITIAL_USERS: UserProfile[] = [
  {
    id: 'user-admin-1',
    username: DEFAULT_ADMIN_USERNAME,
    email: DEFAULT_ADMIN_EMAIL,
    nip: '198205142006041002',
    name: 'Budi Hermawan, S.Kom., M.T.I.',
    role: 'Admin',
    agency: 'Setditjen P2 Kemenkes RI',
    avatarInitials: 'BH',
    status: 'active',
    lastLogin: '2026-11-10 08:30',
    createdAt: '2026-01-15 09:00',
  },
  {
    id: 'user-auditor-1',
    username: 'auditor.itjen',
    email: 'endang.sulastri@kemkes.go.id',
    nip: '197903222003122001',
    name: 'Dra. Endang Sulastri, M.M., CRGP',
    role: 'Auditor',
    agency: 'Inspektorat Jenderal Kemenkes RI',
    avatarInitials: 'ES',
    status: 'active',
    lastLogin: '2026-11-09 14:15',
    createdAt: '2026-01-20 10:30',
  },
  ...buildInitialSatkerUsers(BASELINE_SATKERS),
];

export const DEMO_USERS = INITIAL_USERS;

const USERS_STORAGE_KEY = 'mongrc_users_v1';
const PASSWORDS_STORAGE_KEY = 'mongrc_user_passwords_v1';
const SESSION_USER_KEY = 'mongrc_session_user_id_v1';
const SATKERS_CACHE_KEY = 'mongrc_satkers_v2';

function buildDefaultPasswordMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const u of INITIAL_USERS) {
    const key = u.email.trim().toLowerCase();
    map[key] = u.id === 'user-admin-1' ? DEFAULT_ADMIN_PASSWORD : DEFAULT_USER_PASSWORD;
  }
  return map;
}

function loadStoredPasswords(): Record<string, string> {
  const defaults = buildDefaultPasswordMap();
  try {
    const raw = localStorage.getItem(PASSWORDS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return { ...defaults, ...parsed };
      }
    }
  } catch {
    // ignore storage read error
  }
  return defaults;
}

function saveStoredPasswords(map: Record<string, string>): void {
  try {
    localStorage.setItem(PASSWORDS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore storage write error
  }
}

function formatLocalTimestamp(): string {
  return new Date().toLocaleString('id-ID', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function isSameSatkerPeriodRecord(
  candidate: SatkerData,
  targetNo: number,
  targetYear: string,
  targetPeriod: string,
  fallbackYear?: string,
  fallbackPeriod?: string
): boolean {
  if (candidate.no !== targetNo) return false;
  const candYear = normalizeTextToken(candidate.year || fallbackYear || targetYear);
  const candPeriod = normalizeTextToken(
    candidate.evaluationPeriod || fallbackPeriod || targetPeriod
  );
  const wantYear = normalizeTextToken(targetYear);
  const wantPeriod = normalizeTextToken(targetPeriod);
  return (!candYear || !wantYear || candYear === wantYear) &&
    (!candPeriod || !wantPeriod || candPeriod === wantPeriod);
}

export type NavigationTab = 'executive' | 'heatmap' | 'spreadsheet' | 'users';

interface GRCContextType {
  allSatkers: SatkerData[];
  satkers: SatkerData[];
  uniqueSatkers: SatkerData[];
  users: UserProfile[];
  currentUser: UserProfile | null;
  isAuthenticated: boolean;
  login: (identifier: string, password?: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  addUser: (
    userData: Omit<UserProfile, 'id' | 'createdAt'> & { provisionAuthLogin?: boolean }
  ) => Promise<{ success: boolean; error?: string }>;
  updateUser: (
    userId: string,
    updates: Partial<UserProfile>
  ) => Promise<{ success: boolean; error?: string }>;
  deleteUser: (userId: string) => Promise<{ success: boolean; error?: string }>;
  toggleUserStatus: (userId: string) => Promise<{ success: boolean; error?: string }>;
  provisionAllSatkerAccounts: (
    onProgress?: (done: number, total: number, email: string) => void
  ) => Promise<{
    created: number;
    linked: number;
    failed: number;
    errors: string[];
  }>;
  resetAdminCredentialsToDefault: () => Promise<{ success: boolean; mode?: 'updated'; error?: string }>;
  isProvisioningUsers: boolean;
  isUsersSheetLive: boolean;
  usersSheetUnsupported: boolean;
  isSyncingUsers: boolean;
  refreshUsersFromSpreadsheet: () => Promise<boolean>;
  syncAllUsersToSpreadsheet: () => Promise<{ success: boolean; count: number; error?: string }>;
  selectedSatkerNo: number | null;
  setSelectedSatkerNo: (no: number | null) => void;
  activeTab: NavigationTab;
  setActiveTab: (tab: NavigationTab) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedCategory: string;
  setSelectedCategory: (cat: string) => void;
  // Evaluation Year & Period state
  selectedYear: string;
  setSelectedYear: (year: string) => void;
  selectedPeriod: string;
  setSelectedPeriod: (period: string) => void;
  availableYears: string[];
  availablePeriods: string[];
  availablePeriodsForYear: string[];
  summaryStats: ReturnType<typeof calculateSummaryStats>;
  updateSatkerField: (
    satkerNo: number,
    fieldKey: keyof SatkerData,
    newValue: number | null
  ) => Promise<{ success: boolean; error?: string }>;
  saveSatkerScores: (
    satkerNo: number,
    updates: Partial<
      Pick<
        SatkerData,
        'ski' | 'spip' | 'mri' | 'iepk' | 'spipt' | 'wbkRb' | 'sakip' | 'nka' | 'ikpa' | 'ipAsn' | 'arsip' | 'pekppp'
      >
    >
  ) => Promise<{ success: boolean; error?: string }>;
  bulkImportSatkers: (imported: SatkerData[]) => Promise<void>;
  resetToBaselineData: () => Promise<void>;
  canEditSatker: (satker: SatkerData) => boolean;
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;
  // Google Apps Script Storage & Configuration State
  appConfig: AppConfiguration;
  setSpreadsheetEditLocked: (locked: boolean) => void;
  updateAppConfiguration: (
    updates: Partial<AppConfiguration>
  ) => Promise<{ success: boolean; syncedToSheet: boolean; error?: string }>;
  isConfigSheetLive: boolean;
  configSheetUnsupported: boolean;
  refreshConfigFromSpreadsheet: () => Promise<boolean>;
  appsScriptUrl: string;
  updateAppsScriptUrl: (url: string) => Promise<{ success: boolean; error?: string }>;
  resetAppsScriptUrlToDefault: () => Promise<{ success: boolean; error?: string }>;
  isSheetsLive: boolean;
  isDbConnected: boolean;
  isSyncingDb: boolean;
  lastSyncedAt: string | null;
  dbSyncError: string | null;
  doPostMissing: boolean;
  clearDbSyncError: () => void;
  isDatabaseModalOpen: boolean;
  setIsDatabaseModalOpen: (open: boolean) => void;
  isLoginModalOpen: boolean;
  setIsLoginModalOpen: (open: boolean) => void;
  refreshFromSpreadsheet: () => Promise<boolean>;
  syncLocalStateToDatabase: () => Promise<{ success: boolean; error?: string }>;
}

const GRCContext = createContext<GRCContextType | null>(null);

export const GRCProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [directoryUsers, setDirectoryUsers] = useState<UserProfile[]>(() => {
    try {
      const stored = localStorage.getItem(USERS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as UserProfile[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map(({ password: _pw, ...rest }) => rest);
        }
      }
    } catch {
      // ignore
    }
    return INITIAL_USERS;
  });

  useEffect(() => {
    try {
      const sanitized = directoryUsers.map(({ password: _pw, ...rest }) => rest);
      localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(sanitized));
    } catch {
      // ignore
    }
  }, [directoryUsers]);

  const [currentUser, setCurrentUserState] = useState<UserProfile | null>(() => {
    try {
      const savedUserId = localStorage.getItem(SESSION_USER_KEY);
      if (savedUserId) {
        const storedUsersRaw = localStorage.getItem(USERS_STORAGE_KEY);
        const pool: UserProfile[] = storedUsersRaw ? JSON.parse(storedUsersRaw) : INITIAL_USERS;
        const found = pool.find((u) => u.id === savedUserId && u.status === 'active');
        if (found) {
          const { password: _pw, ...safeUser } = found;
          return safeUser;
        }
      }
    } catch {
      // ignore
    }
    return PUBLIC_VIEWER_USER;
  });

  const setCurrentUser = useCallback((user: UserProfile) => {
    const { password: _pw, ...safeUser } = user;
    setCurrentUserState(safeUser);
    try {
      if (safeUser.role === 'Viewer') {
        localStorage.removeItem(SESSION_USER_KEY);
      } else {
        localStorage.setItem(SESSION_USER_KEY, safeUser.id);
      }
    } catch {
      // ignore
    }
  }, []);

  const isAuthenticated = currentUser !== null && currentUser.role !== 'Viewer';
  const users = useMemo(
    () => (currentUser?.role === 'Admin' ? directoryUsers : []),
    [currentUser?.role, directoryUsers]
  );

  const [activeTab, setActiveTab] = useState<NavigationTab>('executive');
  const [selectedSatkerNo, setSelectedSatkerNo] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  const [appConfig, setAppConfig] = useState<AppConfiguration>(() => {
    try {
      const storedConfig = localStorage.getItem('mongrc_config_v1');
      if (storedConfig) {
        const parsed = JSON.parse(storedConfig);
        const legacyPeriod = String(parsed.evaluationPeriod ?? '').trim();
        const isLegacyYearOnly = !parsed.evaluationYear && /^\d{4}$/.test(legacyPeriod);
        return {
          ...DEFAULT_APP_CONFIG,
          ...parsed,
          evaluationYear:
            parsed.evaluationYear ??
            (isLegacyYearOnly ? legacyPeriod : DEFAULT_APP_CONFIG.evaluationYear),
          evaluationPeriod: isLegacyYearOnly
            ? DEFAULT_APP_CONFIG.evaluationPeriod
            : legacyPeriod || DEFAULT_APP_CONFIG.evaluationPeriod,
          spreadsheetEditLocked:
            parsed.spreadsheetEditLocked !== undefined
              ? Boolean(parsed.spreadsheetEditLocked)
              : DEFAULT_APP_CONFIG.spreadsheetEditLocked,
        };
      }
    } catch {
      // ignore
    }
    return DEFAULT_APP_CONFIG;
  });

  useEffect(() => {
    try {
      localStorage.setItem('mongrc_config_v1', JSON.stringify(appConfig));
    } catch {
      // ignore
    }
  }, [appConfig]);

  // Theme state
  const [theme, setThemeState] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('mongrc_theme');
      if (saved === 'dark' || saved === 'light') return saved;
      if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
    } catch {
      // ignore
    }
    return 'light';
  });

  useEffect(() => {
    try {
      localStorage.setItem('mongrc_theme', theme);
    } catch {
      // ignore
    }
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      document.documentElement.style.colorScheme = theme;
    }
  }, [theme]);

  const setTheme = (nextTheme: 'light' | 'dark') => setThemeState(nextTheme);
  const toggleTheme = () => setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));

  const [allSatkers, setAllSatkers] = useState<SatkerData[]>(() => {
    try {
      const stored =
        localStorage.getItem(SATKERS_CACHE_KEY) || localStorage.getItem('mongrc_satkers_v1');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((s: SatkerData) =>
            s.category === 'Direktorat' ? { ...s, category: 'Pusat' as const } : s
          );
        }
      }
    } catch (e) {
      console.warn('Failed to parse stored satkers, falling back to baseline:', e);
    }
    return BASELINE_SATKERS;
  });

  const [selectedYear, setSelectedYearState] = useState<string>(
    () => appConfig.evaluationYear || DEFAULT_APP_CONFIG.evaluationYear || ''
  );
  const [selectedPeriod, setSelectedPeriodState] = useState<string>(
    () => appConfig.evaluationPeriod || DEFAULT_APP_CONFIG.evaluationPeriod
  );

  const { years: availableYears, periods: availablePeriods, periodsByYear } = useMemo(
    () => extractAvailableYearsAndPeriods(allSatkers, appConfig),
    [allSatkers, appConfig]
  );

  const availablePeriodsForYear = useMemo(() => {
    const forYear = periodsByYear[selectedYear];
    return forYear && forYear.length > 0 ? forYear : availablePeriods;
  }, [periodsByYear, selectedYear, availablePeriods]);

  const setSelectedYear = useCallback(
    (nextYear: string) => {
      setSelectedYearState(nextYear);
      const validPeriods = periodsByYear[nextYear];
      if (validPeriods && validPeriods.length > 0 && !validPeriods.includes(selectedPeriod)) {
        setSelectedPeriodState(validPeriods[validPeriods.length - 1]);
      }
    },
    [periodsByYear, selectedPeriod]
  );

  const setSelectedPeriod = useCallback((nextPeriod: string) => {
    setSelectedPeriodState(nextPeriod);
  }, []);

  const satkers = useMemo(
    () =>
      filterSatkersByPeriod(
        allSatkers,
        selectedYear,
        selectedPeriod,
        appConfig.evaluationYear,
        appConfig.evaluationPeriod
      ),
    [allSatkers, selectedYear, selectedPeriod, appConfig.evaluationYear, appConfig.evaluationPeriod]
  );

  const uniqueSatkers = useMemo(() => {
    if (satkers.length > 0) return satkers;
    const byNo = new Map<number, SatkerData>();
    for (const s of allSatkers) {
      if (!byNo.has(s.no)) byNo.set(s.no, s);
    }
    if (byNo.size > 0) return Array.from(byNo.values()).sort((a, b) => a.no - b.no);
    return BASELINE_SATKERS;
  }, [satkers, allSatkers]);

  // Google Apps Script Endpoint State
  const [appsScriptUrl, setAppsScriptUrl] = useState<string>(() => getStoredAppsScriptUrl());

  const [isSheetsLive, setIsSheetsLive] = useState(false);
  const [isSyncingDb, setIsSyncingDb] = useState(false);
  const [isProvisioningUsers, setIsProvisioningUsers] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [dbSyncError, setDbSyncError] = useState<string | null>(null);
  const [doPostMissing, setDoPostMissing] = useState(false);
  const [isDatabaseModalOpen, setIsDatabaseModalOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  const isDbConnected = isSheetsLive;

  const [isUsersSheetLive, setIsUsersSheetLive] = useState(false);
  const [usersSheetUnsupported, setUsersSheetUnsupported] = useState(false);
  const [isSyncingUsers, setIsSyncingUsers] = useState(false);

  const [isConfigSheetLive, setIsConfigSheetLive] = useState(false);
  const [configSheetUnsupported, setConfigSheetUnsupported] = useState(false);

  const fetchAbortRef = useRef<AbortController | null>(null);
  const usersAbortRef = useRef<AbortController | null>(null);
  const configAbortRef = useRef<AbortController | null>(null);
  const activeSavesRef = useRef(0);
  const appConfigRef = useRef(appConfig);
  appConfigRef.current = appConfig;

  const allSatkersRef = useRef(allSatkers);
  allSatkersRef.current = allSatkers;

  const directoryUsersRef = useRef(directoryUsers);
  directoryUsersRef.current = directoryUsers;

  const selectedYearRef = useRef(selectedYear);
  selectedYearRef.current = selectedYear;
  const selectedPeriodRef = useRef(selectedPeriod);
  selectedPeriodRef.current = selectedPeriod;

  const markSyncedNow = useCallback(() => {
    setIsSheetsLive(true);
    setLastSyncedAt(
      new Date().toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    );
  }, []);

  const reconcilePeriodSelection = useCallback(
    (rows: SatkerData[], nextConfig?: Partial<AppConfiguration> | null) => {
      if (rows.length === 0) return;
      const mergedCfg: AppConfiguration = {
        ...appConfigRef.current,
        ...(nextConfig || {}),
      };
      const curYear = nextConfig?.evaluationYear || selectedYearRef.current || mergedCfg.evaluationYear || '';
      const curPeriod =
        nextConfig?.evaluationPeriod || selectedPeriodRef.current || mergedCfg.evaluationPeriod || '';

      const matchingCurrent = filterSatkersByPeriod(
        rows,
        curYear,
        curPeriod,
        mergedCfg.evaluationYear,
        mergedCfg.evaluationPeriod
      );
      if (matchingCurrent.length > 0) {
        if (nextConfig?.evaluationYear) setSelectedYearState(nextConfig.evaluationYear);
        if (nextConfig?.evaluationPeriod) setSelectedPeriodState(nextConfig.evaluationPeriod);
        return;
      }

      const { years, periodsByYear: byYear, periods } = extractAvailableYearsAndPeriods(rows, mergedCfg);
      const fallbackYear = years[0] || curYear;
      const yearPeriods = byYear[fallbackYear] || periods;
      const fallbackPeriod = yearPeriods[yearPeriods.length - 1] || curPeriod;
      if (fallbackYear) setSelectedYearState(fallbackYear);
      if (fallbackPeriod) setSelectedPeriodState(fallbackPeriod);
    },
    []
  );

  const pushUsersFromAppToSheet = useCallback(
    async (
      urlToUse: string,
      usersList: UserProfile[]
    ): Promise<{ success: boolean; count: number; unsupported?: boolean; error?: string }> => {
      const passwordMap = loadStoredPasswords();
      const mergedMap = new Map<string, UserProfile>();
      for (const u of INITIAL_USERS) mergedMap.set(u.email.trim().toLowerCase(), u);
      for (const u of usersList) mergedMap.set(u.email.trim().toLowerCase(), u);
      const allUsers = Array.from(mergedMap.values());

      const accounts = allUsers.map((u) => {
        const emailKey = u.email.trim().toLowerCase();
        const pw =
          passwordMap[emailKey] ||
          (u.username.toLowerCase() === DEFAULT_ADMIN_USERNAME
            ? DEFAULT_ADMIN_PASSWORD
            : DEFAULT_USER_PASSWORD);
        return serializeUserToSheetAccount(u, pw);
      });

      const remoteRes = await syncUsersToAppsScript(
        urlToUse || DEFAULT_APPS_SCRIPT_URL,
        accounts
      );
      if (!remoteRes.ok) {
        if (remoteRes.unsupportedAction || remoteRes.doPostMissing) {
          setUsersSheetUnsupported(true);
          return {
            success: false,
            count: 0,
            unsupported: true,
            error: 'Google Apps Script belum mendukung aksi syncUsers pada tab Users.',
          };
        }
        return {
          success: false,
          count: 0,
          error: remoteRes.message || 'Gagal menyinkronkan pengguna ke Google Apps Script.',
        };
      }

      setDirectoryUsers(allUsers);
      setIsUsersSheetLive(true);
      setUsersSheetUnsupported(false);
      return { success: true, count: accounts.length };
    },
    []
  );

  const syncAllUsersToSpreadsheet = useCallback(async (): Promise<{
    success: boolean;
    count: number;
    error?: string;
  }> => {
    if (!currentUser || currentUser.role !== 'Admin') {
      return {
        success: false,
        count: 0,
        error: 'Hanya Admin yang dapat menyinkronkan seluruh akun pengguna ke Apps Script.',
      };
    }

    setIsSyncingUsers(true);
    try {
      const res = await pushUsersFromAppToSheet(appsScriptUrl, directoryUsersRef.current);
      return { success: res.success, count: res.count, error: res.error };
    } finally {
      setIsSyncingUsers(false);
    }
  }, [currentUser, pushUsersFromAppToSheet, appsScriptUrl]);

  const refreshUsersFromSpreadsheet = useCallback(
    async (targetUrl?: string): Promise<boolean> => {
      const urlToFetch = (targetUrl || appsScriptUrl || DEFAULT_APPS_SCRIPT_URL).trim();
      usersAbortRef.current?.abort();
      const controller = new AbortController();
      usersAbortRef.current = controller;

      setIsSyncingUsers(true);
      try {
        const res = await fetchUsersFromAppsScript(urlToFetch, controller.signal);
        if (controller.signal.aborted) return false;

        if (!res.usersSheetSupported) {
          setIsUsersSheetLive(false);
          setUsersSheetUnsupported(true);
          return false;
        }

        setUsersSheetUnsupported(false);
        setIsUsersSheetLive(true);

        if (res.users.length === 0) {
          return false;
        }

        setDirectoryUsers(res.users);
        if (Object.keys(res.passwords).length > 0) {
          const currentMap = loadStoredPasswords();
          saveStoredPasswords({ ...currentMap, ...res.passwords });
        }
        return true;
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return false;
        setIsUsersSheetLive(false);
        return false;
      } finally {
        if (usersAbortRef.current === controller) {
          setIsSyncingUsers(false);
        }
      }
    },
    [appsScriptUrl]
  );

  const refreshFromSpreadsheet = useCallback(
    async (targetUrl?: string): Promise<boolean> => {
      const urlToFetch = (targetUrl || appsScriptUrl || DEFAULT_APPS_SCRIPT_URL).trim();
      fetchAbortRef.current?.abort();
      const controller = new AbortController();
      fetchAbortRef.current = controller;

      setIsSyncingDb(true);
      try {
        const rows = await fetchSatkersFromAppsScript(urlToFetch, controller.signal);
        if (controller.signal.aborted) return false;
        setAllSatkers(rows);
        reconcilePeriodSelection(rows);
        setDbSyncError(null);
        markSyncedNow();
        return true;
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return false;
        setIsSheetsLive(false);
        setDbSyncError(
          err instanceof Error
            ? err.message
            : 'Gagal memuat data dari Google Apps Script.'
        );
        return false;
      } finally {
        if (fetchAbortRef.current === controller) {
          setIsSyncingDb(false);
        }
      }
    },
    [appsScriptUrl, reconcilePeriodSelection, markSyncedNow]
  );

  const refreshConfigFromSpreadsheet = useCallback(
    async (targetUrl?: string): Promise<boolean> => {
      const urlToFetch = (targetUrl || appsScriptUrl || DEFAULT_APPS_SCRIPT_URL).trim();
      configAbortRef.current?.abort();
      const controller = new AbortController();
      configAbortRef.current = controller;

      try {
        const res = await fetchConfigFromAppsScript(urlToFetch, controller.signal);
        if (controller.signal.aborted) return false;

        if (!res.configSheetSupported) {
          setIsConfigSheetLive(false);
          setConfigSheetUnsupported(true);
          return false;
        }

        setConfigSheetUnsupported(false);
        setIsConfigSheetLive(true);

        if (res.config && activeSavesRef.current === 0) {
          setAppConfig((prev) => ({
            ...prev,
            ...res.config,
          }));
          reconcilePeriodSelection(allSatkersRef.current, res.config);
        }
        return true;
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return false;
        setIsConfigSheetLive(false);
        return false;
      }
    },
    [appsScriptUrl, reconcilePeriodSelection]
  );

  // Periodic background refresh via Apps Script when live & idle
  useEffect(() => {
    void refreshFromSpreadsheet(appsScriptUrl);
    void refreshUsersFromSpreadsheet(appsScriptUrl);
    void refreshConfigFromSpreadsheet(appsScriptUrl);

    const intervalId = window.setInterval(() => {
      if (
        typeof document !== 'undefined' &&
        !document.hidden &&
        activeSavesRef.current === 0
      ) {
        void refreshFromSpreadsheet(appsScriptUrl);
        void refreshConfigFromSpreadsheet(appsScriptUrl);
      }
    }, 30000);

    return () => {
      window.clearInterval(intervalId);
      fetchAbortRef.current?.abort();
      usersAbortRef.current?.abort();
      configAbortRef.current?.abort();
    };
  }, [
    appsScriptUrl,
    refreshFromSpreadsheet,
    refreshUsersFromSpreadsheet,
    refreshConfigFromSpreadsheet,
  ]);

  const updateAppsScriptUrl = async (
    url: string
  ): Promise<{ success: boolean; error?: string }> => {
    const clean = url.trim();
    if (!clean.startsWith('https://script.google.com/')) {
      return {
        success: false,
        error:
          'URL harus berupa endpoint Web App Google Apps Script (https://script.google.com/...).',
      };
    }

    const stored = setStoredAppsScriptUrl(clean);
    setAppsScriptUrl(stored);
    setDoPostMissing(false);
    setDbSyncError(null);

    const [dataOk] = await Promise.all([
      refreshFromSpreadsheet(stored),
      refreshUsersFromSpreadsheet(stored),
      refreshConfigFromSpreadsheet(stored),
    ]);
    if (!dataOk) {
      return {
        success: false,
        error: 'URL disimpan, namun gagal mengambil data JSON dari Google Apps Script.',
      };
    }
    return { success: true };
  };

  const resetAppsScriptUrlToDefault = async () => {
    return updateAppsScriptUrl(DEFAULT_APPS_SCRIPT_URL);
  };

  const syncLocalStateToDatabase = async (): Promise<{ success: boolean; error?: string }> => {
    if (!currentUser || currentUser.role !== 'Admin') {
      const msg = 'Masuk sebagai Admin terlebih dahulu untuk mengirim seluruh data ke Apps Script.';
      setDbSyncError(msg);
      return { success: false, error: msg };
    }

    const rowsToPush = allSatkers.length > 0 ? allSatkers : BASELINE_SATKERS;

    setIsSyncingDb(true);
    setDbSyncError(null);
    try {
      const res = await pushBulkSatkersToAppsScript(
        appsScriptUrl,
        rowsToPush,
        currentUser.name || 'Admin',
        currentUser.role,
        appConfigRef.current
      );
      if (!res.ok) {
        if (res.doPostMissing) setDoPostMissing(true);
        const msg = res.message || 'Gagal menyinkronkan data ke Google Apps Script.';
        setDbSyncError(msg);
        return { success: false, error: msg };
      }
      setDoPostMissing(false);
      markSyncedNow();
      return { success: true };
    } finally {
      setIsSyncingDb(false);
    }
  };

  // Cache GRC data locally for instant startup
  useEffect(() => {
    try {
      localStorage.setItem(SATKERS_CACHE_KEY, JSON.stringify(allSatkers));
    } catch (e) {
      console.warn('Storage error for satkers:', e);
    }
  }, [allSatkers]);

  const summaryStats = useMemo(() => calculateSummaryStats(satkers), [satkers]);

  const login = async (
    identifier: string,
    password?: string
  ): Promise<{ success: boolean; error?: string }> => {
    const cleanId = identifier.trim();
    if (!cleanId) {
      return { success: false, error: 'Silakan masukkan Username atau Email.' };
    }
    if (!password) {
      return { success: false, error: 'Silakan masukkan kata sandi.' };
    }

    const pool = directoryUsers.length > 0 ? directoryUsers : INITIAL_USERS;
    const resolvedEmail = resolveIdentifierToEmail(cleanId, pool);
    if (!resolvedEmail) {
      return { success: false, error: 'Username/Email atau kata sandi tidak sesuai.' };
    }

    const matchedProfile = pool.find(
      (u) => u.email.trim().toLowerCase() === resolvedEmail
    );
    if (!matchedProfile) {
      return { success: false, error: 'Username/Email atau kata sandi tidak sesuai.' };
    }
    if (matchedProfile.status === 'inactive') {
      return {
        success: false,
        error: 'Akun Anda saat ini dinonaktifkan oleh Administrator.',
      };
    }

    const passwordMap = loadStoredPasswords();
    const expectedPassword =
      passwordMap[resolvedEmail] ||
      (matchedProfile.username.toLowerCase() === DEFAULT_ADMIN_USERNAME
        ? DEFAULT_ADMIN_PASSWORD
        : DEFAULT_USER_PASSWORD);

    if (password !== expectedPassword) {
      return { success: false, error: 'Username/Email atau kata sandi tidak sesuai.' };
    }

    const loggedInProfile: UserProfile = {
      ...matchedProfile,
      lastLogin: new Date().toLocaleString('id-ID'),
    };
    setDirectoryUsers((prev) =>
      prev.map((u) => (u.id === loggedInProfile.id ? loggedInProfile : u))
    );
    setCurrentUser(loggedInProfile);
    setDbSyncError(null);

    void recordUserLoginInAppsScript(appsScriptUrl, loggedInProfile.id);
    return { success: true };
  };

  const logout = () => {
    setDbSyncError(null);
    setCurrentUser(PUBLIC_VIEWER_USER);
  };

  const updateAppConfiguration = async (
    updates: Partial<AppConfiguration>
  ): Promise<{ success: boolean; syncedToSheet: boolean; error?: string }> => {
    if (!currentUser || currentUser.role !== 'Admin') {
      const msg = 'Masuk sebagai Admin untuk mengubah konfigurasi sistem.';
      setDbSyncError(msg);
      return { success: false, syncedToSheet: false, error: msg };
    }

    const nextConfig: AppConfiguration = {
      ...appConfigRef.current,
      ...updates,
      updatedBy: currentUser.name,
      updatedAt: new Date().toISOString(),
    };

    setAppConfig(nextConfig);
    if (updates.evaluationYear) setSelectedYearState(updates.evaluationYear);
    if (updates.evaluationPeriod) setSelectedPeriodState(updates.evaluationPeriod);

    activeSavesRef.current += 1;
    try {
      const res = await saveConfigToAppsScript(appsScriptUrl, nextConfig);
      if (!res.ok) {
        if (res.unsupportedAction || res.doPostMissing) {
          setIsConfigSheetLive(false);
          setConfigSheetUnsupported(true);
          return { success: true, syncedToSheet: false };
        }
        return {
          success: true,
          syncedToSheet: false,
          error: res.message,
        };
      }
      setIsConfigSheetLive(true);
      setConfigSheetUnsupported(false);
      return { success: true, syncedToSheet: true };
    } finally {
      activeSavesRef.current = Math.max(0, activeSavesRef.current - 1);
    }
  };

  const setSpreadsheetEditLocked = (locked: boolean) => {
    if (appConfigRef.current.spreadsheetEditLocked === locked) return;
    void updateAppConfiguration({ spreadsheetEditLocked: locked });
  };

  const addUser = async (
    userData: Omit<UserProfile, 'id' | 'createdAt'> & { provisionAuthLogin?: boolean }
  ): Promise<{ success: boolean; error?: string }> => {
    if (!currentUser || currentUser.role !== 'Admin') {
      return {
        success: false,
        error: 'Hanya Admin yang berwenang menambahkan pengguna.',
      };
    }

    const exists = directoryUsers.some(
      (u) =>
        u.username.toLowerCase() === userData.username.toLowerCase() ||
        u.email.toLowerCase() === userData.email.toLowerCase() ||
        u.nip === userData.nip
    );

    if (exists) {
      return { success: false, error: 'Username, Email, atau NIP sudah terdaftar dalam sistem.' };
    }

    const { provisionAuthLogin: _prov, password: rawPassword, ...profileFields } = userData;
    const emailLower = profileFields.email.trim().toLowerCase();
    const initialPassword = (rawPassword && rawPassword.trim()) || DEFAULT_USER_PASSWORD;

    const newUser: UserProfile = {
      ...profileFields,
      email: emailLower,
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date().toLocaleString('id-ID', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
    };

    const userAccount = serializeUserToSheetAccount(newUser, initialPassword);
    const remoteRes = await handleCreateUserInAppsScript(appsScriptUrl, userAccount);
    if (!remoteRes.ok) {
      if (remoteRes.unsupportedAction || remoteRes.doPostMissing) {
        setUsersSheetUnsupported(true);
      } else if (isUsersSheetLive) {
        return {
          success: false,
          error: remoteRes.message || 'Gagal menambahkan pengguna ke tab Users Google Apps Script.',
        };
      }
    } else {
      setIsUsersSheetLive(true);
      setUsersSheetUnsupported(false);
    }

    const passwords = loadStoredPasswords();
    passwords[emailLower] = initialPassword;
    saveStoredPasswords(passwords);

    setDirectoryUsers((prev) => [newUser, ...prev]);
    return { success: true };
  };

  const provisionAllSatkerAccounts = async (
    onProgress?: (done: number, total: number, email: string) => void
  ): Promise<{
    created: number;
    linked: number;
    failed: number;
    errors: string[];
  }> => {
    if (!currentUser || currentUser.role !== 'Admin') {
      return {
        created: 0,
        linked: 0,
        failed: 1,
        errors: ['Hanya Admin yang berwenang menyinkronkan akun Satker.'],
      };
    }

    setIsProvisioningUsers(true);
    const satkerSeeds = buildInitialSatkerUsers(
      uniqueSatkers.length > 0 ? uniqueSatkers : BASELINE_SATKERS
    );
    const passwords = loadStoredPasswords();
    const byEmail = new Map<string, UserProfile>();
    for (const u of directoryUsers) {
      byEmail.set(u.email.trim().toLowerCase(), u);
    }

    let created = 0;
    let linked = 0;
    const syncedList: UserProfile[] = [];

    for (let i = 0; i < satkerSeeds.length; i++) {
      const seed = satkerSeeds[i];
      const emailKey = seed.email.trim().toLowerCase();
      const existing = byEmail.get(emailKey);
      onProgress?.(i + 1, satkerSeeds.length, seed.email);

      if (existing) {
        linked += 1;
        syncedList.push({
          ...existing,
          username: seed.username,
          email: emailKey,
          role: 'Satker PIC',
          assignedSatker: seed.assignedSatker,
          assignedSatkerNo: seed.assignedSatkerNo,
          status: existing.status || 'active',
        });
      } else {
        created += 1;
        syncedList.push(seed);
      }

      if (!passwords[emailKey]) {
        passwords[emailKey] = DEFAULT_USER_PASSWORD;
      }
    }

    saveStoredPasswords(passwords);

    const mergedMap = new Map<string, UserProfile>();
    for (const u of directoryUsers) mergedMap.set(u.email.trim().toLowerCase(), u);
    for (const s of syncedList) mergedMap.set(s.email.trim().toLowerCase(), s);
    const mergedUsers = Array.from(mergedMap.values());

    setDirectoryUsers(mergedUsers);

    const errors: string[] = [];
    const accountsToSync = mergedUsers.map((u) =>
      serializeUserToSheetAccount(
        u,
        passwords[u.email.trim().toLowerCase()] ||
          (u.username.toLowerCase() === DEFAULT_ADMIN_USERNAME
            ? DEFAULT_ADMIN_PASSWORD
            : DEFAULT_USER_PASSWORD)
      )
    );

    const remoteRes = await syncUsersToAppsScript(appsScriptUrl, accountsToSync);
    if (!remoteRes.ok) {
      if (remoteRes.unsupportedAction || remoteRes.doPostMissing) {
        setUsersSheetUnsupported(true);
      } else if (remoteRes.message) {
        errors.push(remoteRes.message);
      }
    } else {
      setIsUsersSheetLive(true);
      setUsersSheetUnsupported(false);
    }

    setIsProvisioningUsers(false);
    return { created, linked, failed: errors.length > 0 ? 1 : 0, errors };
  };

  const resetAdminCredentialsToDefault = async (): Promise<{
    success: boolean;
    mode?: 'updated';
    error?: string;
  }> => {
    if (!currentUser || currentUser.role !== 'Admin') {
      return {
        success: false,
        error: 'Masuk sebagai Admin terlebih dahulu untuk mereset kredensial admin.p2.',
      };
    }

    const adminEmail = DEFAULT_ADMIN_EMAIL.trim().toLowerCase();
    const passwords = loadStoredPasswords();
    passwords[adminEmail] = DEFAULT_ADMIN_PASSWORD;
    saveStoredPasswords(passwords);

    const baseAdmin =
      directoryUsers.find((u) => u.id === 'user-admin-1') ||
      directoryUsers.find((u) => u.email.trim().toLowerCase() === adminEmail) ||
      INITIAL_USERS[0];

    const updatedAdmin: UserProfile = {
      ...baseAdmin,
      username: DEFAULT_ADMIN_USERNAME,
      email: adminEmail,
      role: 'Admin',
      status: 'active',
    };

    setDirectoryUsers((prev) => {
      const exists = prev.some((u) => u.id === updatedAdmin.id);
      return exists
        ? prev.map((u) => (u.id === updatedAdmin.id ? updatedAdmin : u))
        : [updatedAdmin, ...prev];
    });
    if (currentUser.id === updatedAdmin.id || currentUser.role === 'Admin') {
      setCurrentUser(updatedAdmin);
    }

    const remoteRes = await handleUpdateUserInAppsScript(
      appsScriptUrl,
      serializeUserToSheetAccount(updatedAdmin, DEFAULT_ADMIN_PASSWORD)
    );
    if (remoteRes.unsupportedAction || remoteRes.doPostMissing) {
      setUsersSheetUnsupported(true);
    }

    return { success: true, mode: 'updated' };
  };

  const updateUser = async (
    userId: string,
    updates: Partial<UserProfile>
  ): Promise<{ success: boolean; error?: string }> => {
    if (!currentUser || currentUser.role !== 'Admin') {
      return {
        success: false,
        error: 'Hanya Admin yang berwenang mengubah profil pengguna.',
      };
    }

    const targetUser = directoryUsers.find((u) => u.id === userId);
    if (!targetUser) {
      return { success: false, error: 'Pengguna tidak ditemukan.' };
    }

    const { password: nextPassword, ...profileUpdates } = updates;
    const updatedUser: UserProfile = {
      ...targetUser,
      ...profileUpdates,
      email: (profileUpdates.email || targetUser.email).trim().toLowerCase(),
    };

    const passwords = loadStoredPasswords();
    const oldEmailKey = targetUser.email.trim().toLowerCase();
    const newEmailKey = updatedUser.email;
    const explicitPassword = nextPassword && nextPassword.trim() ? nextPassword.trim() : undefined;
    const resolvedPassword =
      explicitPassword ||
      passwords[oldEmailKey] ||
      (updatedUser.username.toLowerCase() === DEFAULT_ADMIN_USERNAME
        ? DEFAULT_ADMIN_PASSWORD
        : DEFAULT_USER_PASSWORD);

    const remoteRes = await handleUpdateUserInAppsScript(
      appsScriptUrl,
      serializeUserToSheetAccount(updatedUser, explicitPassword)
    );
    if (!remoteRes.ok) {
      if (remoteRes.unsupportedAction || remoteRes.doPostMissing) {
        setUsersSheetUnsupported(true);
      } else if (isUsersSheetLive) {
        return {
          success: false,
          error: remoteRes.message || 'Gagal memperbarui pengguna di tab Users Google Apps Script.',
        };
      }
    } else {
      setIsUsersSheetLive(true);
      setUsersSheetUnsupported(false);
    }

    passwords[newEmailKey] = resolvedPassword;
    saveStoredPasswords(passwords);

    setDirectoryUsers((prev) => prev.map((u) => (u.id === userId ? updatedUser : u)));
    if (currentUser.id === userId) {
      setCurrentUser(updatedUser);
    }

    return { success: true };
  };

  const deleteUser = async (
    userId: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!currentUser || currentUser.role !== 'Admin') {
      return {
        success: false,
        error: 'Hanya Admin yang berwenang menghapus akun pengguna.',
      };
    }

    if (currentUser.id === userId) {
      return { success: false, error: 'Anda tidak dapat menghapus akun Anda sendiri saat sedang aktif.' };
    }

    const targetUser = directoryUsers.find((u) => u.id === userId);
    if (!targetUser) {
      return { success: false, error: 'Pengguna tidak ditemukan.' };
    }

    const remoteRes = await handleDeleteUserInAppsScript(appsScriptUrl, userId);
    if (!remoteRes.ok) {
      if (remoteRes.unsupportedAction || remoteRes.doPostMissing) {
        setUsersSheetUnsupported(true);
      } else if (isUsersSheetLive) {
        return {
          success: false,
          error: remoteRes.message || 'Gagal menghapus pengguna dari tab Users Google Apps Script.',
        };
      }
    } else {
      setIsUsersSheetLive(true);
      setUsersSheetUnsupported(false);
    }

    setDirectoryUsers((prev) => prev.filter((u) => u.id !== userId));

    return { success: true };
  };

  const toggleUserStatus = async (
    userId: string
  ): Promise<{ success: boolean; error?: string }> => {
    const targetUser = directoryUsers.find((u) => u.id === userId);
    if (!targetUser) return { success: false, error: 'Pengguna tidak ditemukan.' };
    const newStatus = targetUser.status === 'active' ? 'inactive' : 'active';
    return updateUser(userId, { status: newStatus });
  };

  const canEditSatker = useCallback(
    (satker: SatkerData): boolean => canUserEditSatker(currentUser, satker),
    [currentUser]
  );

  const persistSatkerMutation = useCallback(
    async (
      targetSatker: SatkerData,
      finalSatker: SatkerData
    ): Promise<{ success: boolean; error?: string }> => {
      setAllSatkers((prev) =>
        prev.map((s) =>
          isSameSatkerPeriodRecord(
            s,
            targetSatker.no,
            selectedYearRef.current,
            selectedPeriodRef.current,
            appConfigRef.current.evaluationYear,
            appConfigRef.current.evaluationPeriod
          )
            ? finalSatker
            : s
        )
      );

      activeSavesRef.current += 1;
      setIsSyncingDb(true);
      try {
        const res = await pushSatkerUpdateToAppsScript(
          appsScriptUrl,
          finalSatker,
          currentUser?.name || 'Pengguna',
          currentUser?.role,
          appConfigRef.current
        );
        if (!res.ok) {
          if (res.doPostMissing) setDoPostMissing(true);
          const msg = res.message || 'Gagal menyimpan pembaruan ke Google Apps Script.';
          setDbSyncError(msg);
          setAllSatkers((prev) =>
            prev.map((s) =>
              isSameSatkerPeriodRecord(
                s,
                targetSatker.no,
                selectedYearRef.current,
                selectedPeriodRef.current,
                appConfigRef.current.evaluationYear,
                appConfigRef.current.evaluationPeriod
              )
                ? targetSatker
                : s
            )
          );
          return { success: false, error: msg };
        }

        setDoPostMissing(false);
        setDbSyncError(null);
        markSyncedNow();
        return { success: true };
      } finally {
        activeSavesRef.current = Math.max(0, activeSavesRef.current - 1);
        setIsSyncingDb(false);
      }
    },
    [appsScriptUrl, currentUser, markSyncedNow]
  );

  const updateSatkerField = async (
    satkerNo: number,
    fieldKey: keyof SatkerData,
    newValue: number | null
  ): Promise<{ success: boolean; error?: string }> => {
    const readOnlyCalculatedFields: Array<keyof SatkerData> = [
      'pSki',
      'pSpip',
      'pMri',
      'pIepk',
      'pWbkRb',
      'pSakip',
      'pNka',
      'pIkpa',
      'pIpAsn',
      'pArsip',
      'pPekppp',
      'average',
    ];
    if (readOnlyCalculatedFields.includes(fieldKey)) {
      return {
        success: false,
        error:
          'Kolom skor normalisasi persentase dan komposit bersifat otomatis (Read-Only) dan dihitung dari skor riil masing-masing dimensi.',
      };
    }

    if (!currentUser || currentUser.role === 'Viewer') {
      return {
        success: false,
        error: 'Mode Baca Publik: Masuk sebagai Admin atau PIC terdaftar untuk menyimpan perubahan.',
      };
    }

    if (appConfigRef.current.spreadsheetEditLocked) {
      return {
        success: false,
        error: 'Mode pengeditan spreadsheet saat ini terkunci (Hanya-Baca).',
      };
    }

    const targetSatker = satkers.find((s) => s.no === satkerNo);
    if (!targetSatker) {
      return { success: false, error: 'Satuan kerja tidak ditemukan pada periode evaluasi aktif.' };
    }

    if (!canEditSatker(targetSatker)) {
      return {
        success: false,
        error: `Akses ditolak: Unit kerja Anda (${currentUser.assignedSatker || currentUser.agency}) tidak berwenang mengubah nilai untuk ${targetSatker.satker}.`,
      };
    }

    const oldValue = targetSatker[fieldKey] as number | null;
    if (oldValue === newValue) {
      return { success: true };
    }

    const nowFormatted = formatLocalTimestamp();
    const activeYear = targetSatker.year || selectedYear || appConfig.evaluationYear;
    const activePeriod =
      targetSatker.evaluationPeriod || selectedPeriod || appConfig.evaluationPeriod;

    const updatedDraft: SatkerData = {
      ...targetSatker,
      year: activeYear,
      evaluationPeriod: activePeriod,
      [fieldKey]: newValue,
      lastUpdatedBy: currentUser.name,
      lastUpdatedAt: nowFormatted,
    };

    const finalSatker = recalculateSatkerScores(updatedDraft);
    return persistSatkerMutation(targetSatker, finalSatker);
  };

  const saveSatkerScores = async (
    satkerNo: number,
    updates: Partial<
      Pick<
        SatkerData,
        'ski' | 'spip' | 'mri' | 'iepk' | 'spipt' | 'wbkRb' | 'sakip' | 'nka' | 'ikpa' | 'ipAsn' | 'arsip' | 'pekppp'
      >
    >
  ): Promise<{ success: boolean; error?: string }> => {
    if (!currentUser || currentUser.role === 'Viewer') {
      return {
        success: false,
        error: 'Mode Baca Publik: Masuk sebagai Admin atau PIC terdaftar untuk menyimpan perubahan.',
      };
    }

    if (appConfigRef.current.spreadsheetEditLocked) {
      return {
        success: false,
        error: 'Mode pengeditan spreadsheet saat ini terkunci (Hanya-Baca).',
      };
    }

    const targetSatker = satkers.find((s) => s.no === satkerNo);
    if (!targetSatker) {
      return { success: false, error: 'Satuan kerja tidak ditemukan pada periode evaluasi aktif.' };
    }

    if (!canEditSatker(targetSatker)) {
      return {
        success: false,
        error: `Akses ditolak: Unit kerja Anda (${currentUser.assignedSatker || currentUser.agency}) tidak berwenang mengubah nilai untuk ${targetSatker.satker}.`,
      };
    }

    const nowFormatted = formatLocalTimestamp();
    const activeYear = targetSatker.year || selectedYear || appConfig.evaluationYear;
    const activePeriod =
      targetSatker.evaluationPeriod || selectedPeriod || appConfig.evaluationPeriod;

    const allowedRawKeys = new Set<string>(INDICATOR_METAS.map((m) => m.key));
    const sanitizedUpdates: Partial<SatkerData> = {};
    let hasChanges = false;

    for (const [key, nextVal] of Object.entries(updates)) {
      if (!allowedRawKeys.has(key)) continue;
      const typedKey = key as keyof SatkerData;
      const prevVal = targetSatker[typedKey] as number | null;
      if (prevVal === nextVal) continue;

      (sanitizedUpdates as Record<string, unknown>)[key] = nextVal;
      hasChanges = true;
    }

    if (!hasChanges) {
      return { success: true };
    }

    const updatedDraft: SatkerData = {
      ...targetSatker,
      ...sanitizedUpdates,
      year: activeYear,
      evaluationPeriod: activePeriod,
      lastUpdatedBy: currentUser.name,
      lastUpdatedAt: nowFormatted,
    };

    const finalSatker = recalculateSatkerScores(updatedDraft);
    return persistSatkerMutation(targetSatker, finalSatker);
  };

  const bulkImportSatkers = async (imported: SatkerData[]) => {
    if (!currentUser || currentUser.role !== 'Admin') {
      setDbSyncError('Hanya Admin yang dapat mengimpor data ke Google Apps Script.');
      return;
    }

    const normalizedImported = imported.map((s) => ({
      ...s,
      year: s.year || selectedYear || appConfig.evaluationYear,
      evaluationPeriod: s.evaluationPeriod || selectedPeriod || appConfig.evaluationPeriod,
    }));

    // Merge imported period records into allSatkers (preserving other periods!)
    setAllSatkers((prev) => {
      const next = [...prev];
      for (const imp of normalizedImported) {
        const idx = next.findIndex((existing) =>
          isSameSatkerPeriodRecord(
            existing,
            imp.no,
            imp.year || selectedYear,
            imp.evaluationPeriod || selectedPeriod,
            appConfig.evaluationYear,
            appConfig.evaluationPeriod
          )
        );
        if (idx !== -1) next[idx] = imp;
        else next.push(imp);
      }
      return next;
    });

    const authorName = currentUser.name || 'Administrator';

    setIsSyncingDb(true);
    pushBulkSatkersToAppsScript(
      appsScriptUrl,
      normalizedImported,
      authorName,
      currentUser.role,
      appConfigRef.current
    )
      .then((res) => {
        if (res.ok) {
          setDoPostMissing(false);
          setDbSyncError(null);
          markSyncedNow();
        } else {
          if (res.doPostMissing) setDoPostMissing(true);
          if (res.message) setDbSyncError(res.message);
        }
      })
      .finally(() => setIsSyncingDb(false));
  };

  const resetToBaselineData = async () => {
    if (!currentUser || currentUser.role !== 'Admin') {
      setDbSyncError('Hanya Admin yang dapat mereset data ke baseline.');
      return;
    }

    const baselineForPeriod = BASELINE_SATKERS.map((s) => ({
      ...s,
      year: selectedYear || appConfig.evaluationYear,
      evaluationPeriod: selectedPeriod || appConfig.evaluationPeriod,
    }));

    setAllSatkers(baselineForPeriod);
    const authorName = currentUser.name || 'Administrator';

    setIsSyncingDb(true);
    pushBulkSatkersToAppsScript(
      appsScriptUrl,
      baselineForPeriod,
      authorName,
      currentUser.role,
      appConfigRef.current
    )
      .then((res) => {
        if (res.ok) {
          setDoPostMissing(false);
          setDbSyncError(null);
          markSyncedNow();
        } else {
          if (res.doPostMissing) setDoPostMissing(true);
          if (res.message) setDbSyncError(res.message);
        }
      })
      .finally(() => setIsSyncingDb(false));
  };

  return (
    <GRCContext.Provider
      value={{
        allSatkers,
        satkers,
        uniqueSatkers,
        users,
        currentUser,
        isAuthenticated,
        login,
        logout,
        addUser,
        updateUser,
        deleteUser,
        toggleUserStatus,
        provisionAllSatkerAccounts,
        resetAdminCredentialsToDefault,
        isProvisioningUsers,
        isUsersSheetLive,
        usersSheetUnsupported,
        isSyncingUsers,
        refreshUsersFromSpreadsheet,
        syncAllUsersToSpreadsheet,
        selectedSatkerNo,
        setSelectedSatkerNo,
        activeTab,
        setActiveTab,
        searchQuery,
        setSearchQuery,
        selectedCategory,
        setSelectedCategory,
        selectedYear,
        setSelectedYear,
        selectedPeriod,
        setSelectedPeriod,
        availableYears,
        availablePeriods,
        availablePeriodsForYear,
        summaryStats,
        updateSatkerField,
        saveSatkerScores,
        bulkImportSatkers,
        resetToBaselineData,
        canEditSatker,
        theme,
        setTheme,
        toggleTheme,
        appConfig,
        setSpreadsheetEditLocked,
        updateAppConfiguration,
        isConfigSheetLive,
        configSheetUnsupported,
        refreshConfigFromSpreadsheet,
        appsScriptUrl,
        updateAppsScriptUrl,
        resetAppsScriptUrlToDefault,
        isSheetsLive,
        isDbConnected,
        isSyncingDb,
        lastSyncedAt,
        dbSyncError,
        doPostMissing,
        clearDbSyncError: () => setDbSyncError(null),
        isDatabaseModalOpen,
        setIsDatabaseModalOpen,
        isLoginModalOpen,
        setIsLoginModalOpen,
        refreshFromSpreadsheet,
        syncLocalStateToDatabase,
      }}
    >
      {children}
    </GRCContext.Provider>
  );
};

export const useGRC = () => {
  const ctx = useContext(GRCContext);
  if (!ctx) throw new Error('useGRC must be used within a GRCProvider');
  return ctx;
};
