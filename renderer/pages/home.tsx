import { useEffect } from 'react'
import { useRouter } from 'next/router'

export default function HomePage() {
  const router = useRouter()

  useEffect(() => {
    // Redirect to unified page
    router.replace('/unified')
  }, [router])

  return null
}