import type { Dict } from '@/i18n/en';

/** Name, Arabic name, description and head — shared by "Add department" and a department's edit form. */
export function DepartmentFields({
  t,
  people,
  d,
}: {
  t: Dict;
  people: { id: string; nameEn: string }[];
  d?: { id: string; nameEn: string; nameAr: string | null; description: string | null; headId: string | null };
}) {
  const p = d?.id ?? 'new';
  return (
    <>
      <div className="grid-form">
        <div className="field">
          <label htmlFor={`name-${p}`}>{t.departments.name}</label>
          <input id={`name-${p}`} name="nameEn" type="text" required defaultValue={d?.nameEn} />
        </div>
        <div className="field">
          <label htmlFor={`name-ar-${p}`}>{t.departments.nameAr}</label>
          <input id={`name-ar-${p}`} name="nameAr" type="text" dir="rtl" lang="ar" defaultValue={d?.nameAr ?? ''} />
        </div>
        <div className="field">
          <label htmlFor={`head-${p}`}>{t.departments.head}</label>
          <select id={`head-${p}`} name="headId" defaultValue={d?.headId ?? ''}>
            <option value="">{t.departments.noHead}</option>
            {people.map((x) => (
              <option key={x.id} value={x.id}>
                {x.nameEn}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor={`desc-${p}`}>{t.departments.description}</label>
        <textarea
          id={`desc-${p}`}
          name="description"
          rows={3}
          maxLength={1000}
          defaultValue={d?.description ?? ''}
          placeholder={t.departments.descriptionPlaceholder}
        />
      </div>
    </>
  );
}
