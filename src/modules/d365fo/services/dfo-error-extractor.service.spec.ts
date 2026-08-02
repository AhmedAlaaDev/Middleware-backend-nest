import { isDfoResourceNotFoundError } from '../errors/dfo-api.error';

import { DfoErrorExtractorService } from './dfo-error-extractor.service';

describe('DfoErrorExtractorService', () => {
  const service = new DfoErrorExtractorService();

  it('extracts a nested D365 exception from an HTTP 500 response', () => {
    const error = {
      message: 'Request failed with status code 500',
      response: {
        status: 500,
        data: {
          Message: 'An error has occurred.',
          InnerException: {
            ExceptionMessage:
              'Exception has been thrown by the target of an invocation.',
            InnerException: {
              ExceptionMessage:
                'The offset account PSD EG is invalid for this journal line.',
            },
          },
        },
      },
    };

    expect(service.extractMessage(error)).toBe(
      'The offset account PSD EG is invalid for this journal line.',
    );
  });

  it('preserves response details after the HTTP error is wrapped', () => {
    const wrapped = service.toError(
      {
        message: 'Request failed with status code 500',
        response: {
          status: 500,
          data: {
            Message: 'An unexpected X++ error occurred.',
            error: {
              innererror: {
                message: 'Financial dimension value 16545 was not accepted.',
              },
            },
          },
        },
      },
      { method: 'POST', endpoint: '/cash-out' },
    );

    expect(service.extractMessage(wrapped)).toBe(
      'Financial dimension value 16545 was not accepted.',
    );
    expect(wrapped.status).toBe(500);
  });

  it('keeps the existing OData code and inner-error format', () => {
    const normalized = service.normalize({
      response: {
        status: 400,
        data: {
          error: {
            code: 'BadRequest',
            message: 'The request is invalid.',
            innererror: { message: 'Vendor account is blocked.' },
          },
        },
      },
    });

    expect(normalized.message).toBe('[BadRequest] Vendor account is blocked.');
    expect(normalized.code).toBe('BadRequest');
  });

  it('classifies an already-deleted D365 resource as not found', () => {
    const wrapped = service.toError(
      {
        response: {
          status: 400,
          data: {
            error: {
              message: 'An error has occurred.',
              innererror: {
                message: 'No resources were found when selecting for update.',
              },
            },
          },
        },
      },
      { method: 'DELETE', endpoint: '/journal-header' },
    );

    expect(wrapped.message).toContain(
      'No resources were found when selecting for update.',
    );
    expect(isDfoResourceNotFoundError(wrapped)).toBe(true);
  });
});
