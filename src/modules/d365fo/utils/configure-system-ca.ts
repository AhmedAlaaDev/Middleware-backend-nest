import * as tls from 'node:tls';

export interface SystemCaTlsApi {
  getCACertificates?: (type?: 'default' | 'system') => string[];
  setDefaultCACertificates?: (certificates: string[]) => void;
}

export interface SystemCaConfigurationResult {
  addedCertificateCount: number;
  configured: boolean;
  error?: string;
  supported: boolean;
  systemCertificateCount: number;
  totalCertificateCount: number;
}

const runtimeTls = tls as unknown as SystemCaTlsApi;

/**
 * Adds the operating-system trust store to Node's bundled/default CAs.
 * Certificate verification remains enabled; no insecure TLS fallback is used.
 */
export function configureSystemCertificateAuthorities(
  tlsApi: SystemCaTlsApi = runtimeTls,
): SystemCaConfigurationResult {
  if (
    typeof tlsApi.getCACertificates !== 'function' ||
    typeof tlsApi.setDefaultCACertificates !== 'function'
  ) {
    return {
      addedCertificateCount: 0,
      configured: false,
      supported: false,
      systemCertificateCount: 0,
      totalCertificateCount: 0,
    };
  }

  try {
    const defaultCertificates = tlsApi.getCACertificates('default');
    const systemCertificates = tlsApi.getCACertificates('system');
    const mergedCertificates = [
      ...new Set([...defaultCertificates, ...systemCertificates]),
    ];

    tlsApi.setDefaultCACertificates(mergedCertificates);

    return {
      addedCertificateCount:
        mergedCertificates.length - new Set(defaultCertificates).size,
      configured: true,
      supported: true,
      systemCertificateCount: systemCertificates.length,
      totalCertificateCount: mergedCertificates.length,
    };
  } catch (error: unknown) {
    return {
      addedCertificateCount: 0,
      configured: false,
      error: error instanceof Error ? error.message : String(error),
      supported: true,
      systemCertificateCount: 0,
      totalCertificateCount: 0,
    };
  }
}
