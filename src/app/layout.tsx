import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title:"Klasrum — School, in sync",
  description:"A modern school management workspace for administrators, teachers and students.",
  manifest:"/manifest.webmanifest",
  appleWebApp:{capable:true,statusBarStyle:"default",title:"Klasrum"}
};
export const viewport: Viewport = {themeColor:"#3157d5",width:"device-width",initialScale:1};
export default function RootLayout({children}:{children:React.ReactNode}){
 return <html lang="en"><body>{children}<script dangerouslySetInnerHTML={{__html:`if ('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));`}} /></body></html>;
}