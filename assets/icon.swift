import AppKit
let image=NSImage(size:NSSize(width:1024,height:1024))
image.lockFocus()
NSColor(calibratedRed:0.15,green:0.29,blue:0.25,alpha:1).setFill()
NSBezierPath(roundedRect:NSRect(x:0,y:0,width:1024,height:1024),xRadius:210,yRadius:210).fill()
let line=NSBezierPath();line.lineWidth=78;line.lineCapStyle = .round;line.lineJoinStyle = .round
line.move(to:NSPoint(x:270,y:230));line.line(to:NSPoint(x:270,y:760));line.line(to:NSPoint(x:512,y:440));line.line(to:NSPoint(x:754,y:760));line.line(to:NSPoint(x:754,y:230))
NSColor(calibratedRed:0.96,green:0.96,blue:0.91,alpha:1).setStroke();line.stroke()
NSColor(calibratedRed:0.84,green:0.51,blue:0.23,alpha:1).setFill();NSBezierPath(ovalIn:NSRect(x:725,y:755,width:100,height:100)).fill()
image.unlockFocus()
let bitmap=NSBitmapImageRep(data:image.tiffRepresentation!)!
try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:CommandLine.arguments[1]))
