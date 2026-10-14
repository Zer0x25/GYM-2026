import { useEffect, useState } from "react";
import QRCode from "qrcode";
export function MemberQr({ token }: { token: string }) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    setUrl("");
    setError(false);
    void QRCode.toString(token, { type: "svg", margin: 4, errorCorrectionLevel: "M" })
      .then((svg) => {
        if (active) setUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [token]);
  return (
    <div data-testid="member-qr" className="mx-auto w-fit rounded-xl bg-white p-2">
      {url ? (
        <img src={url} alt="Código QR personal de ingreso" className="h-52 w-52" />
      ) : (
        <p className="grid h-52 w-52 place-items-center text-sm text-slate-600">
          {error ? "No se pudo generar el QR" : "Preparando QR…"}
        </p>
      )}
    </div>
  );
}
