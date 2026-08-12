import { DeleteBatchCommand } from '@/modules/data-batch/commands/delete-batch.command';
import { DeleteBatchHandler } from '@/modules/data-batch/commands/handlers/delete-batch.handler';
import { DataBatchStatus } from '@/modules/data-batch/enums/data-batch.enum';

describe(DeleteBatchHandler.name, () => {
  const actor = {
    id: 'user-1',
    name: 'Uploader',
    email: 'uploader@example.com',
  };

  function buildHandler(batch: Record<string, unknown>) {
    const dataBatchService = {
      getByIdAsync: jest.fn().mockResolvedValue(batch),
      deleteAsync: jest.fn().mockResolvedValue(undefined),
    };
    const postingControl = {
      discardPostingForDelete: jest.fn().mockResolvedValue({
        removedJobIds: [],
        purgedDurableJobIds: [],
      }),
    };
    const logs = { emit: jest.fn().mockResolvedValue(undefined) };
    return {
      handler: new DeleteBatchHandler(
        dataBatchService as any,
        postingControl as any,
        logs as any,
      ),
      dataBatchService,
      postingControl,
    };
  }

  it.each([
    [DataBatchStatus.Posting, []],
    [DataBatchStatus.Posted, ['Mesco-000014718']],
    [DataBatchStatus.Canceled, ['Mesco-000014718']],
  ])(
    'force-deletes batch even when status=%s and DFO IDs=%j',
    async (status, dfoIds) => {
      const { handler, dataBatchService, postingControl } = buildHandler({
        id: 'batch-1',
        status,
        dfoIds,
      });

      await handler.execute(new DeleteBatchCommand('batch-1', actor));

      expect(postingControl.discardPostingForDelete).toHaveBeenCalled();
      expect(dataBatchService.deleteAsync).toHaveBeenCalledWith('batch-1');
    },
  );

  it('allows deletion before DFO posting has started', async () => {
    const { handler, dataBatchService, postingControl } = buildHandler({
      id: 'batch-1',
      status: DataBatchStatus.PendingPosting,
      dfoIds: [],
    });

    await handler.execute(new DeleteBatchCommand('batch-1', actor));

    expect(postingControl.discardPostingForDelete).toHaveBeenCalled();
    expect(dataBatchService.deleteAsync).toHaveBeenCalledWith('batch-1');
  });
});
