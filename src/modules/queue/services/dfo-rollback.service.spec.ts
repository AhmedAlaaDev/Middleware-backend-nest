import { DfoRollbackService } from './dfo-rollback.service';
import { PostingErrorCollector } from './posting-error-collector.service';

import { DfoApiError } from '@/modules/d365fo/errors/dfo-api.error';
import { IDfoPostingStrategy } from '@/modules/queue/strategies/dfo-posting-strategy.interface';

describe('DfoRollbackService', () => {
  const alreadyAbsentError = new DfoApiError({
    message: 'No resources were found when selecting for update.',
    status: 400,
    isResourceNotFound: true,
  });

  const buildStrategy = (): IDfoPostingStrategy =>
    ({
      listLinesForHeader: jest.fn().mockResolvedValue([]),
      deleteHeader: jest.fn().mockRejectedValue(alreadyAbsentError),
      deleteLinesInBatches: jest.fn().mockResolvedValue({
        successful: [],
        failed: [],
      }),
    }) as unknown as IDfoPostingStrategy;

  it('treats an already-absent header as a successful rollback', async () => {
    const service = new DfoRollbackService();
    const collector = new PostingErrorCollector();

    const result = await service.rollbackAll(
      buildStrategy(),
      [{ headerKey: 'Mesco-000013757', dataAreaId: 'm-p' }],
      20,
      collector,
    );

    expect(result.successfullyDeletedHeaders).toEqual(['Mesco-000013757']);
    expect(result.failedToDeleteHeaders).toEqual([]);
    expect(collector.hasErrors()).toBe(false);
  });

  it('applies the same idempotent behavior to chunked header rollback', async () => {
    const service = new DfoRollbackService();
    const collector = new PostingErrorCollector();

    const result = await service.rollbackHeaders(
      buildStrategy(),
      ['Mesco-000013757'],
      'm-p',
      20,
      collector,
    );

    expect(result.successfullyDeleted).toEqual(['Mesco-000013757']);
    expect(result.failedToDelete).toEqual([]);
    expect(collector.hasErrors()).toBe(false);
  });
});
