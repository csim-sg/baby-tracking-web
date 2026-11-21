import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import '../style.scss'
export const Route = createRootRoute({ component: () => <><HeadContent/><Outlet/><Scripts/></>, head:()=>({meta:[{title:'Tiny Daybook — printable baby tracker'},{name:'description',content:'Create a sweet, printable baby care tracker.'}]})})
