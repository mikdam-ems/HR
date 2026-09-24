import { ImportForm } from '@/components/ImportForm';
import { getDict } from '@/i18n';
import { requirePermission } from '@/server/session';

export default async function ImportPage() {
  await requirePermission('people.manage');
  const { t } = await getDict();
  return (
    <>
      <h1>{t.import.title}</h1>
      <p className="muted" style={{ margin: 0, maxWidth: 640 }}>
        {t.import.intro}
      </p>
      {/* A plain link: Next's <Link> is for pages, not file downloads. */}
      <a href="/people/import/template" download>
        {t.import.template}
      </a>
      <ImportForm t={t.import} />
    </>
  );
}
