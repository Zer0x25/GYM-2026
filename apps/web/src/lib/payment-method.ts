export function paymentMethodLabel(method: unknown): string {
  switch (method) {
    case "cash":
      return "Efectivo";
    case "transfer":
      return "Transferencia";
    case "transbank":
      return "Transbank externo";
    default:
      return "Método desconocido";
  }
}
