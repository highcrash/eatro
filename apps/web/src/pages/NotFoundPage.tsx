import { Link } from 'react-router-dom';
import { useWebsiteContent } from '../lib/cms';

export default function NotFoundPage() {
  const { data: content } = useWebsiteContent();
  const bg = content?.notFoundBg;
  const text = (content as any)?.notFoundText || null;

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      {bg && (
        <div className="absolute inset-0">
          <img src={bg} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-black/70" />
        </div>
      )}
      <div className="relative text-center px-6 max-w-2xl">
        <p className="font-display text-[12rem] md:text-[16rem] leading-none text-accent/20 select-none">404</p>
        <h1 className="font-display text-5xl md:text-7xl tracking-wider text-text -mt-16 mb-4">
          PAGE NOT FOUND
        </h1>
        <p className="font-body text-muted text-lg mb-8 max-w-md mx-auto">
          {text || "The page you're looking for doesn't exist or has been moved."}
        </p>
        <div className="flex gap-4 justify-center flex-wrap">
          <Link to="/" className="bg-accent hover:opacity-90 text-white font-body text-sm tracking-widest uppercase px-8 py-4 transition">
            BACK TO HOME
          </Link>
          <Link to="/menu" className="border border-border hover:border-text text-text font-body text-sm tracking-widest uppercase px-8 py-4 transition">
            VIEW MENU
          </Link>
        </div>
      </div>
    </div>
  );
}
