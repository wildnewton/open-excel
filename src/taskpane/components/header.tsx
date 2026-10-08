import type { FC } from "react";

export interface HeaderProps {
  title: string;
  logo: string;
  message: string;
}

const Header: FC<HeaderProps> = ({ title, logo, message }) => (
  <section className="flex flex-col items-center py-12 bg-gray-100">
    <img width="90" height="90" src={logo} alt={title} />
    <h1 className="text-4xl mt-4">{message}</h1>
  </section>
);

export default Header;
