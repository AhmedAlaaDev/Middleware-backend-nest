import { AccountCustomerInvoiceMappingMongoRepository } from './account-customer-invoice-mapping.mongo.repository';

/**
 * Account/customer-invoice mappings are scoped by company. Legacy documents
 * (saved before company existed) belong to m-p only, so MAS never inherits them.
 */
describe('AccountCustomerInvoiceMappingMongoRepository company scope', () => {
  const createRepository = () => {
    const chain = {
      lean: jest.fn(),
      skip: jest.fn(),
      limit: jest.fn(),
      exec: jest.fn(() => Promise.resolve([])),
    };
    chain.lean.mockReturnValue(chain);
    chain.skip.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
    const model = { find: jest.fn(() => chain) };
    const repository = new AccountCustomerInvoiceMappingMongoRepository(
      model as never,
    );
    return { repository, model };
  };

  it('m-p also matches legacy mappings that have no company', async () => {
    const { repository, model } = createRepository();

    await repository.getList({ serviceType: 3, company: 'm-p' });

    expect(model.find).toHaveBeenCalledWith({
      serviceType: 3,
      $or: [
        { company: 'm-p' },
        { company: { $exists: false } },
        { company: null },
      ],
    });
  });

  it('mas matches only mappings saved for mas, never legacy m-p mappings', async () => {
    const { repository, model } = createRepository();

    await repository.getList({ serviceType: 3, company: 'mas' });

    expect(model.find).toHaveBeenCalledWith({
      serviceType: 3,
      $or: [{ company: 'mas' }],
    });
  });

  it('applies no company condition when no company is requested', async () => {
    const { repository, model } = createRepository();

    await repository.getList({ serviceType: 3 });

    expect(model.find).toHaveBeenCalledWith({ serviceType: 3 });
  });
});

describe('AccountCustomerInvoiceMappingMongoRepository upsert ownership', () => {
  const createRepository = () => {
    const model = {
      bulkWrite: jest.fn((..._ops: unknown[]) => Promise.resolve({})),
    };
    const repository = new AccountCustomerInvoiceMappingMongoRepository(
      model as never,
    );
    return { repository, model };
  };

  const base = {
    name: 'Freight Account',
    customerAccount: 'CUST001',
    invoiceAccount: 'INV001',
    serviceType: 1 as never,
  };

  it('saves a MAS mapping under MAS, without touching the same-named M-P mapping', async () => {
    const { repository, model } = createRepository();

    await repository.upsertMany([{ ...base, company: 'mas' }]);

    const op = (
      model.bulkWrite.mock.calls[0][0] as Array<{
        updateOne: { filter: unknown; update: { $set: { company: string } } };
      }>
    )[0].updateOne;
    expect(op.filter).toEqual({
      name: 'Freight Account',
      serviceType: 1,
      company: 'mas',
    });
    expect(op.update.$set.company).toBe('mas');
  });

  it('lets M-P update its own legacy rows that have no company', async () => {
    const { repository, model } = createRepository();

    await repository.upsertMany([{ ...base, company: 'm-p' }]);

    const op = (
      model.bulkWrite.mock.calls[0][0] as Array<{
        updateOne: { filter: Record<string, unknown> };
      }>
    )[0].updateOne;
    expect(op.filter).toEqual({
      name: 'Freight Account',
      serviceType: 1,
      $or: [
        { company: 'm-p' },
        { company: { $exists: false } },
        { company: null },
      ],
    });
  });

  it('stores a save without company as m-p, as before', async () => {
    const { repository, model } = createRepository();

    await repository.upsertMany([base]);

    const op = (
      model.bulkWrite.mock.calls[0][0] as Array<{
        updateOne: { update: { $set: { company: string } } };
      }>
    )[0].updateOne;
    expect(op.update.$set.company).toBe('m-p');
  });
});
