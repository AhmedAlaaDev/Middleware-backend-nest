export class DeleteDfoJournalCommand {
  constructor(
    public readonly journalBatchNumber: string,
    public readonly company: string,
    public readonly actor: { id: string; name: string; email: string },
  ) {}
}
