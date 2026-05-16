import { withProperties } from '@app/utils/typeHelpers';
import { memo, useMemo } from 'react';

type TBodyProps = {
  children: React.ReactNode;
};

const TBody = memo(({ children }: TBodyProps) => {
  return (
    <tbody className="divide-y divide-gray-700 bg-gray-800">{children}</tbody>
  );
});

TBody.displayName = 'TBody';

const TH = memo(
  ({ children, className, ...props }: React.ComponentPropsWithoutRef<'th'>) => {
    const style = useMemo(
      () =>
        [
          'px-4 py-3 bg-gray-500 text-left text-xs leading-4 font-medium text-gray-200 uppercase tracking-wider truncate',
          className,
        ]
          .filter(Boolean)
          .join(' '),
      [className]
    );

    return (
      <th className={style} {...props}>
        {children}
      </th>
    );
  }
);

TH.displayName = 'TH';

type TDProps = {
  alignText?: 'left' | 'center' | 'right';
  noPadding?: boolean;
};

const TD = memo(
  ({
    children,
    alignText = 'left',
    noPadding,
    className,
    ...props
  }: TDProps & React.ComponentPropsWithoutRef<'td'>) => {
    const style = useMemo(
      () =>
        [
          'text-sm leading-5 text-white',
          alignText === 'center'
            ? 'text-center'
            : alignText === 'right'
              ? 'text-right'
              : 'text-left',
          noPadding ? undefined : 'px-4 py-4',
          className,
        ]
          .filter(Boolean)
          .join(' '),
      [alignText, className, noPadding]
    );

    return (
      <td className={style} {...props}>
        {children}
      </td>
    );
  }
);

TD.displayName = 'TD';

type TableProps = {
  children: React.ReactNode;
};

const Table = memo(({ children }: TableProps) => {
  return (
    <div className="flex flex-col">
      <div className="-mx-4 my-2 overflow-x-auto md:mx-0 lg:mx-0">
        <div className="inline-block min-w-full py-2 align-middle">
          <div className="overflow-hidden rounded-lg shadow md:mx-0 lg:mx-0">
            <table className="min-w-full">{children}</table>
          </div>
        </div>
      </div>
    </div>
  );
});

Table.displayName = 'Table';

export default withProperties(Table, { TH, TBody, TD });
