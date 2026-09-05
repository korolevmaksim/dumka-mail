import { useId, useMemo, useState } from 'react';
import { useAppStore } from '../../stores/AppStore';
import { parseSearchQuery } from '../../../../shared/search';
import { updateSearchFilters, resolveSavedSearch } from '../../../../shared/searchFilters';
import { emitToast } from '../../lib/toastBus';
import type { SavedMailSearch } from '../../../../shared/productivity';

export function SearchFiltersPanel({ query, onChange }: { query: string; onChange: (query: string) => void }) {
  const store = useAppStore();
  const [name, setName] = useState('');
  const [period, setPeriod] = useState<SavedMailSearch['period']>('fixed');
  const [busy, setBusy] = useState(false);
  const senderListId = useId();
  const parsed = parseSearchQuery(query);
  const field = 'dm-productivity-input';
  const save = async () => {
    if (!store.activeAccount || busy) return;
    setBusy(true);
    try {
      await store.saveProductivity({ kind: 'search', id: crypto.randomUUID(), revision: 0,
        updatedAt: new Date().toISOString(), accountId: store.activeAccount.id === 'unified' ? 'unified' : store.activeAccount.email,
        name: name.trim(), query, period });
      setName('');
      emitToast({ type: 'success', message: 'Search saved.' });
    } catch (error) { emitToast({ type: 'error', message: error instanceof Error ? error.message : 'Could not save search.' }); }
    finally { setBusy(false); }
  };
  const senders = useMemo(() => {
    const values = new Map(store.contacts.slice(0, 500).map(contact => [contact.email, contact.displayName]));
    for (const thread of store.threads) {
      if (values.size >= 500) break;
      if (!values.has(thread.senderEmail)) values.set(thread.senderEmail, thread.senderNames.join(', '));
    }
    return [...values];
  }, [store.contacts, store.threads]);
  return (
    <div className="dm-search-filters dm-productivity px-4 py-3" onKeyDown={event => event.stopPropagation()}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-40 flex-1 flex-col gap-1">From
          <input aria-label="Sender" className={field} list={senderListId} value={parsed.from || ''} placeholder="Name or email"
            onChange={event => onChange(updateSearchFilters(query, { from: event.target.value || undefined }))} />
          <datalist id={senderListId}>{senders.map(([email, name]) => <option value={email} key={email}>{name}</option>)}</datalist>
        </label>
        <label className="flex flex-col gap-1">From date<input aria-label="From date" type="date" className={field} value={parsed.after || ''} max={parsed.before}
          onChange={event => onChange(updateSearchFilters(query, { after: event.target.value || undefined }))} /></label>
        <label className="flex flex-col gap-1">Through date<input aria-label="Through date" type="date" className={field} value={parsed.before || ''} min={parsed.after}
          onChange={event => onChange(updateSearchFilters(query, { before: event.target.value || undefined }))} /></label>
        <label className="flex flex-col gap-1">Attachments<select aria-label="Attachments" className={field} value={parsed.hasAttachment === undefined ? 'any' : String(parsed.hasAttachment)}
          onChange={event => onChange(updateSearchFilters(query, { hasAttachment: event.target.value === 'any' ? undefined : event.target.value === 'true' }))}>
          <option value="any">Any mail</option><option value="true">With attachments</option><option value="false">Without attachments</option>
        </select></label>
        <label className="flex flex-col gap-1">Read status<select aria-label="Read status" className={field} value={parsed.isUnread === undefined ? 'any' : String(parsed.isUnread)}
          onChange={event => onChange(updateSearchFilters(query, { isUnread: event.target.value === 'any' ? undefined : event.target.value === 'true' }))}>
          <option value="any">All</option><option value="true">Unread</option><option value="false">Read</option>
        </select></label>
      </div>
      <form className="mt-3 flex flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); void save(); }}>
        <input className={`${field} min-w-40 flex-1`} aria-label="Saved search name" placeholder="Name this search" maxLength={120} value={name} onChange={event => setName(event.target.value)} />
        <select className={field} aria-label="Saved date range" value={period} onChange={event => setPeriod(event.target.value === 'lastMonth' ? 'lastMonth' : 'fixed')}>
          <option value="fixed">Keep these dates</option><option value="lastMonth">Always the last 30 days</option>
        </select>
        <button className="dm-productivity-button" disabled={busy || !name.trim() || !query.trim() || !store.productivityLoaded || !store.activeAccount}>Save search</button>
        <button type="button" className="dm-productivity-button" onClick={() => onChange('')}>Clear search</button>
      </form>
      {store.productivityError && <p role="alert">{store.productivityError} <button className="dm-productivity-button" onClick={() => void store.refreshProductivity()}>Retry</button></p>}
      {store.savedMailSearches.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Saved searches">
        <span>Saved:</span>{store.savedMailSearches.map(saved => <span key={saved.id} className="flex items-center gap-1">
          <button className="dm-productivity-button" title={saved.query} onClick={() => onChange(resolveSavedSearch(saved))}>{saved.name}{saved.period === 'lastMonth' ? ' · Last 30 days' : ''}</button>
          <button className="dm-productivity-button" aria-label={`Delete saved search ${saved.name}`} onClick={() => void store.deleteProductivity(saved).catch(error => emitToast({ type: 'error', message: String(error) }))}>Remove</button>
        </span>)}
      </div>}
    </div>
  );
}
