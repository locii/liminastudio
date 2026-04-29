import Image from "next/image";

const DOWNLOAD_URL = "https://github.com/locii/liminastudio/releases/latest";

const features = [
  {
    title: "Multitrack Timeline",
    body: "Arrange music across multiple tracks on a pixel-accurate timeline. Drag, trim, and reorder clips freely.",
  },
  {
    title: "Crossfades",
    body: "Overlap clips to create smooth equal-power crossfades automatically. Fine-tune fade shape and duration.",
  },
  {
    title: "Volume Automation",
    body: "Draw gain nodes directly on each clip to shape the energy arc of your breathwork set.",
  },
  {
    title: "WAV & MP3 Export",
    body: "Render your full mix to a single high-quality audio file ready to share or play in a session.",
  },
  {
    title: "Track Listing PDF",
    body: "Generate a clean printable track listing with artist, timecodes, and duration for your records.",
  },
  {
    title: "Free — Always",
    body: "Limina Studio is free to download and use. No subscription, no watermark, no limits.",
  },
];

export default function Home() {
  return (
    <main className="flex flex-col">

      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-6 border-b border-cream-border">
        <div className="flex items-center gap-3">
          <Image src="/limina-logo.png" alt="Limina Studio" width={36} height={36} className="rounded-lg" />
          <span className="font-cinzel text-sm tracking-[0.2em] uppercase text-forest">
            Limina Studio
          </span>
        </div>
        <a
          href={DOWNLOAD_URL}
          className="font-sans text-xs font-medium tracking-widest uppercase px-5 py-2.5 bg-forest text-cream rounded hover:bg-forest-light transition-colors"
        >
          Download Free
        </a>
      </nav>

      {/* Hero */}
      <section className="flex flex-col items-center text-center px-6 pt-24 pb-20 gap-8">
        <Image
          src="/limina-logo.png"
          alt="Limina Studio"
          width={96}
          height={96}
          className="rounded-2xl"
          priority
        />
        <div className="flex flex-col items-center gap-4">
          <h1 className="font-cinzel text-5xl md:text-6xl tracking-[0.15em] uppercase text-forest">
            Limina Studio
          </h1>
          <p className="font-sans text-xs tracking-[0.3em] uppercase text-forest-muted">
            Music for Breathwork
          </p>
        </div>
        <p className="font-sans font-light text-lg text-forest-muted max-w-xl leading-relaxed">
          A free multitrack audio editor built for Holotropic Breathwork
          facilitators. Arrange your music, shape the journey, export the mix.
        </p>
        <div className="flex flex-col items-center gap-2 pt-2">
          <a
            href={DOWNLOAD_URL}
            className="font-sans text-sm font-medium tracking-widest uppercase px-8 py-3.5 bg-forest text-cream rounded hover:bg-forest-light transition-colors"
          >
            Download for Mac — Free
          </a>
          <span className="font-sans text-xs text-forest-muted">
            macOS 10.12+ · Apple Silicon &amp; Intel
          </span>
        </div>
      </section>

      {/* Divider */}
      <div className="w-full border-t border-cream-border" />

      {/* Features */}
      <section className="bg-cream-dark px-6 py-20">
        <div className="max-w-5xl mx-auto">
          <h2 className="font-cinzel text-center text-xs tracking-[0.3em] uppercase text-forest-muted mb-16">
            What&apos;s Inside
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-cream-border">
            {features.map((f) => (
              <div key={f.title} className="bg-cream-dark p-8 flex flex-col gap-3">
                <h3 className="font-cinzel text-sm tracking-widest uppercase text-forest">
                  {f.title}
                </h3>
                <p className="font-sans font-light text-sm text-forest-muted leading-relaxed">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="w-full border-t border-cream-border" />

      {/* CTA */}
      <section className="flex flex-col items-center text-center px-6 py-24 gap-6">
        <h2 className="font-cinzel text-3xl tracking-[0.15em] uppercase text-forest">
          Ready to Build Your Set?
        </h2>
        <p className="font-sans font-light text-base text-forest-muted max-w-md leading-relaxed">
          Download Limina Studio and start arranging your breathwork music in
          minutes. Free, forever.
        </p>
        <a
          href={DOWNLOAD_URL}
          className="font-sans text-sm font-medium tracking-widest uppercase px-8 py-3.5 bg-forest text-cream rounded hover:bg-forest-light transition-colors mt-2"
        >
          Download Free
        </a>
      </section>

      {/* Footer */}
      <footer className="border-t border-cream-border px-8 py-6 flex items-center justify-between">
        <span className="font-cinzel text-xs tracking-[0.2em] uppercase text-forest-muted">
          Limina Studio
        </span>
        <span className="font-sans text-xs text-forest-muted">
          Part of{" "}
          <a href="https://musicforbreathwork.com" className="underline underline-offset-2 hover:text-forest transition-colors">
            Music for Breathwork
          </a>
        </span>
      </footer>

    </main>
  );
}
