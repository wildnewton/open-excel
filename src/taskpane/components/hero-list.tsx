import type { FC, JSX } from "react";

export interface HeroListItem {
  icon: JSX.Element;
  primaryText: string;
}

export interface HeroListProps {
  message: string;
  items: HeroListItem[];
}

const HeroList: FC<HeroListProps> = ({ items, message }) => (
  <div className="flex flex-col items-center p-4">
    <h2 className="text-base mb-4">{message}</h2>
    <ul className="space-y-3">
      {items.map((item) => (
        <li className="flex items-center gap-2" key={item.primaryText}>
          <span className="text-gray-500">{item.icon}</span>
          <span className="text-sm">{item.primaryText}</span>
        </li>
      ))}
    </ul>
  </div>
);

export default HeroList;
