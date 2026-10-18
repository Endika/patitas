export default function UnsavedNotice({ className }: { className?: string }) {
  return (
    <p role="status" className={className}>
      No se puede guardar en este navegador; tus cachorros se perderán al cerrar.
    </p>
  )
}
