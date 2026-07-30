import {
  configureSystemCertificateAuthorities,
  SystemCaTlsApi,
} from '@/modules/d365fo/utils/configure-system-ca';

describe(configureSystemCertificateAuthorities.name, () => {
  it('merges system roots with existing defaults without duplicates', () => {
    const setDefaultCACertificates = jest.fn();
    const tlsApi: SystemCaTlsApi = {
      getCACertificates: (type) =>
        type === 'system'
          ? ['corporate-root', 'shared-root']
          : ['bundled-root', 'shared-root'],
      setDefaultCACertificates,
    };

    expect(configureSystemCertificateAuthorities(tlsApi)).toEqual({
      addedCertificateCount: 1,
      configured: true,
      supported: true,
      systemCertificateCount: 2,
      totalCertificateCount: 3,
    });
    expect(setDefaultCACertificates).toHaveBeenCalledWith([
      'bundled-root',
      'shared-root',
      'corporate-root',
    ]);
  });

  it('reports unsupported runtimes without disabling certificate checks', () => {
    expect(configureSystemCertificateAuthorities({})).toEqual({
      addedCertificateCount: 0,
      configured: false,
      supported: false,
      systemCertificateCount: 0,
      totalCertificateCount: 0,
    });
  });
});
