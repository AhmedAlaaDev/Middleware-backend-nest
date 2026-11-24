import { DataBatchMongoRepository } from './data-batch.mongo.repository';

/**
 * The company filter must be part of the Mongo query used for both the page
 * and the count, so paging and totals only see the selected company.
 */
describe('DataBatchMongoRepository company filter', () => {
  const createModel = () => {
    const chain = {
      sort: jest.fn(),
      skip: jest.fn(),
      limit: jest.fn(),
      lean: jest.fn(),
      exec: jest.fn(() => Promise.resolve([])),
    };
    chain.sort.mockReturnValue(chain);
    chain.skip.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
    chain.lean.mockReturnValue(chain);

    const model = {
      find: jest.fn(() => chain),
      countDocuments: jest.fn(() => ({
        exec: jest.fn(() => Promise.resolve(0)),
      })),
    };
    return model;
  };

  it('filters the page query by company', async () => {
    const model = createModel();
    const repo = new DataBatchMongoRepository(model as never);

    await repo.getList({ company: 'mas' }, { skipCount: 0, maxCount: 20 });

    expect(model.find).toHaveBeenCalledWith({ company: 'mas' });
  });

  it('filters the count by the same company as the page', async () => {
    const model = createModel();
    const repo = new DataBatchMongoRepository(model as never);

    await repo.getCount({ company: 'm-p', entryProcessorTypes: [1] });

    expect(model.countDocuments).toHaveBeenCalledWith({
      company: 'm-p',
      entryProcessorType: { $in: [1] },
    });
  });

  it('does not add a company condition when no company is selected', async () => {
    const model = createModel();
    const repo = new DataBatchMongoRepository(model as never);

    await repo.getCount({});

    expect(model.countDocuments).toHaveBeenCalledWith({});
  });
});
